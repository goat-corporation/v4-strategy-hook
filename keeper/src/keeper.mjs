import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { keeperDecision } from "./policy.mjs";

const ABI = [
  { type: "function", name: "strategyFeesAccrued", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "executionThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "executionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "lastExecutionTimestamp", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "cooldown", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "observationIndex", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "observationCardinality", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "minObservationSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "maxObservationGap", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  {
    type: "function",
    name: "observations",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint32" }, { type: "int56" }, { type: "int24" }]
  },
  { type: "function", name: "recordObservation", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint32" }, { type: "int24" }, { type: "int56" }] },
  { type: "function", name: "executeStrategy", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }] }
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return value.toLowerCase() === "true";
}

const rpcUrl = required("RPC_URL");
const hookAddress = required("HOOK_ADDRESS");
const expectedChainId = Number(process.env.EXPECTED_CHAIN_ID || "1");
const intervalSeconds = Number(process.env.KEEPER_INTERVAL_SECONDS || "300");
const execute = bool("EXECUTE");
const runOnce = bool("RUN_ONCE");
const dryRunAccount = "0x0000000000000000000000000000000000000001";

if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) throw new Error("EXPECTED_CHAIN_ID is invalid");
if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 30) throw new Error("KEEPER_INTERVAL_SECONDS must be at least 30");

const account = execute ? privateKeyToAccount(required("KEEPER_PRIVATE_KEY")) : dryRunAccount;
const transport = http(rpcUrl, { timeout: 15_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: mainnet, transport });
const walletClient = execute ? createWalletClient({ account, chain: mainnet, transport }) : null;

async function send(request, label) {
  if (!execute) {
    console.log(JSON.stringify({ mode: "dry-run", action: label, simulation: "passed" }));
    return null;
  }
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(JSON.stringify({ mode: "execute", action: label, hash, blockNumber: receipt.blockNumber.toString() }));
  return receipt;
}

async function simulate(functionName) {
  return publicClient.simulateContract({ address: hookAddress, abi: ABI, functionName, account });
}

async function cycle() {
  const [chainId, bytecode, block] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: hookAddress }),
    publicClient.getBlock({ blockTag: "latest" })
  ]);
  if (chainId !== expectedChainId) throw new Error(`chain mismatch: expected ${expectedChainId}, received ${chainId}`);
  if (!bytecode || bytecode === "0x") throw new Error("HOOK_ADDRESS has no bytecode");

  const [accrued, threshold, count, lastExecution, cooldown, index, cardinality, minSpacing, maxGap] =
    await publicClient.multicall({
      contracts: [
        "strategyFeesAccrued",
        "executionThreshold",
        "executionCount",
        "lastExecutionTimestamp",
        "cooldown",
        "observationIndex",
        "observationCardinality",
        "minObservationSpacing",
        "maxObservationGap"
      ].map((functionName) => ({ address: hookAddress, abi: ABI, functionName })),
      allowFailure: false
    });
  const observation = await publicClient.readContract({
    address: hookAddress,
    abi: ABI,
    functionName: "observations",
    args: [index]
  });
  const now = Number(block.timestamp);
  const observationAge = now - Number(observation[0]);

  const decision = keeperDecision({
    accrued,
    threshold,
    executionCount: count,
    lastExecution,
    cooldown,
    now,
    observationAge,
    minObservationSpacing: minSpacing
  });
  const status = {
    timestamp: now,
    execute,
    accruedWei: accrued.toString(),
    accruedEth: formatEther(accrued),
    thresholdWei: threshold.toString(),
    executionCount: count.toString(),
    cooldownReady: decision.cooldownReady,
    observationCardinality: Number(cardinality),
    observationAge,
    maxObservationGap: Number(maxGap)
  };
  console.log(JSON.stringify(status));

  if (decision.recordObservation) {
    const { request } = await simulate("recordObservation");
    await send(request, "recordObservation");
  }

  if (!decision.executeStrategy) return;

  try {
    const { request } = await simulate("executeStrategy");
    await send(request, "executeStrategy");
  } catch (error) {
    console.warn(JSON.stringify({ action: "executeStrategy", simulation: "blocked", reason: error.shortMessage || error.message }));
  }
}

async function main() {
  do {
    try {
      await cycle();
    } catch (error) {
      console.error(JSON.stringify({ cycle: "failed", reason: error.shortMessage || error.message }));
      if (runOnce) process.exitCode = 1;
    }
    if (runOnce) break;
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  } while (true);
}

await main();
