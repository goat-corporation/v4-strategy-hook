import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "submissions/v4-strategy-hook/submission.json");
const s = JSON.parse(fs.readFileSync(file, "utf8"));

const modes = [
  "zeroForOne-exactInput",
  "zeroForOne-exactOutput",
  "oneForZero-exactInput",
  "oneForZero-exactOutput"
];
const platformOwner = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";

function callback(callback, necessity) {
  return {
    callback,
    necessity,
    allowedReverts: "Wrong PoolManager, wrong PoolKey, unsafe arithmetic, unsupported partial fill or unbacked settlement reverts the complete action.",
    userExitImpact: "The callback applies only to initialization or swaps; standard liquidity removal remains available.",
    noSelfCallImpact: "The strategy cannot swap its canonical PoolKey; its one nested swap uses the immutable separate target PoolKey."
  };
}

function action(order, operation, currency, deltaEffect, amountRule, counterparty = "PoolManager") {
  return {
    order,
    actor: "hook",
    operation,
    currency,
    assetKind: "native",
    deltaOwner: "hook",
    deltaEffect,
    counterparty,
    authorizationRule: operation === "mint-claim" || operation === "burn-claim"
      ? "Only the hook mints or burns its own native-currency ERC-6909 claims inside the authenticated PoolManager callback."
      : null,
    msgValueRule: null,
    amountRule,
    completionDeadline: "before-hook-return"
  };
}

function zeroComponent() {
  return {
    mode: "zero-only",
    formula: null,
    minimum: "0",
    maximum: "0",
    minimumSign: "zero",
    maximumSign: "zero",
    positiveSettlementActions: [],
    negativeSettlementActions: []
  };
}

function feeComponent(component) {
  return {
    mode: "positive-only",
    formula: "Return the bounded inclusive native-ETH fee for the selected direction and exactness mode.",
    minimum: "zero base units after integer rounding",
    maximum: "at most ten percent of verified gross native quote volume",
    minimumSign: "zero",
    maximumSign: "positive",
    positiveSettlementActions: [
      action(1, "mint-claim", component, "negative", "Mint an ERC-6909 native claim exactly equal to the returned hook credit.", "hook")
    ],
    negativeSettlementActions: []
  };
}

function beforeQuadrant(specifiedCurrency, unspecifiedCurrency, amountSign) {
  return {
    supported: true,
    specifiedCurrency,
    unspecifiedCurrency,
    amountSign,
    specifiedComponent: feeComponent("specified"),
    unspecifiedComponent: zeroComponent(),
    residualAmmEquation: "amountSpecified-plus-specifiedDelta",
    finalCallerDeltaEquation: "pool-manager-swap-delta-minus-hook-delta",
    specifiedDeltaCanConsumeEntireAmount: false,
    rounding: "Gross exact-input fees round down; net exact-output fees gross up with rounding upward before partition.",
    zeroAmmLeg: "forbidden",
    partialFillRule: "The afterSwap callback proves the full adjusted native AMM leg executed; otherwise the complete swap reverts.",
    slippageInvariant: "The router evaluates final caller deltas after the hook fee.",
    failureRule: "Any mismatch, overflow, claim mint failure or unsupported partial fill reverts the complete swap."
  };
}

function afterQuadrant(specifiedCurrency, unspecifiedCurrency, amountSign) {
  return {
    supported: true,
    specifiedCurrency,
    unspecifiedCurrency,
    amountSign,
    specifiedComponent: zeroComponent(),
    unspecifiedComponent: feeComponent("unspecified"),
    residualAmmEquation: "amountSpecified-plus-specifiedDelta",
    finalCallerDeltaEquation: "pool-manager-swap-delta-minus-hook-delta",
    specifiedDeltaCanConsumeEntireAmount: false,
    rounding: "Gross output fees round down; exact-output native input is grossed up and rounded upward.",
    zeroAmmLeg: "forbidden",
    partialFillRule: "The fee uses the final PoolManager native delta, so unexecuted volume creates no liability.",
    slippageInvariant: "The router evaluates final caller deltas after the hook fee.",
    failureRule: "Any arithmetic, claim mint or final-delta failure reverts the complete swap."
  };
}

function quadrant(basis) {
  return {
    currency: "currency0",
    basis,
    formula: "effective=max(selected,1000 hundredths of a bip); platform=1000; strategy=floor((effective-platform)*strategyShare); creator=project-strategy.",
    rounding: "down",
    maximumHundredthsOfBip: 100000
  };
}

s.stage = "prototype";
s.builder.github = "goat-corporation";
s.builder.contact = "https://x.com/v4str_eth";
s.builder.beneficiary = null;
s.builder.licenseDeclaration = "Model-owned Solidity and keeper source are offered under MIT; imported dependencies retain their pinned upstream licenses.";
s.model = {
  id: "v4-strategy-hook",
  name: "V4 Strategy Hook",
  summary: "Convert an immutable share of canonical-pool native quote fees into permissionless, oracle-guarded target-token buybacks and irreversible burns.",
  userOutcome: "A creator configures one launch pool whose visible fees fund isolated creator and Programmable claims plus transparent buyback-and-burn execution.",
  category: "market-structure",
  whyV4: "One v4 hook atomically enforces quote-side fees in all four swap modes, retains backed PoolManager claims and later consumes only the strategy liability through a separate v4 pool."
};
s.publicMetadata = {
  project: {
    name: "V4 Strategy Hook",
    description: "A customizable Programmable launch hook for transparent creator fees and permissionless TWAP-guarded buyback-and-burn strategies.",
    projectUri: "https://v4str.fun",
    logoUri: "https://v4str.fun/images/v4str-nav-1a4c43d6.png",
    logoContentHash: "sha256:1a4c43d60e3abc98fcd55b9f7bb1c9efbf22513218d51f2e157896fcbc512ac0",
    metadataMutable: true,
    metadataOwner: "V4STR project publisher; website metadata is not contract authority."
  },
  token: {
    name: "Launch token configured per deployment",
    symbol: "CONFIGURED",
    metadataUri: null,
    metadataContentHash: null,
    logoUri: null,
    logoContentHash: null,
    metadataMutable: false,
    metadataOwner: null
  },
  claimedAffiliations: [
    { organization: "Uniswap", relationship: "technology-use", evidenceUri: null },
    { organization: "Programmable", relationship: "technology-use", evidenceUri: "https://github.com/0xprogrammable/programmable" }
  ],
  providerPresentations: []
};
s.assets = [
  {
    id: "eth",
    role: "quote",
    origin: "native-eth",
    address: null,
    decimals: 18,
    decimalsSource: "native-eth-protocol",
    supplyPolicy: "native",
    initialSupply: null,
    behaviors: ["standard"],
    controls: []
  },
  {
    id: "launched-token",
    role: "launched",
    origin: "new-fixed-supply",
    address: null,
    decimals: 18,
    decimalsSource: "implementation-constant",
    supplyPolicy: "fixed-at-creation",
    initialSupply: "1000000000000000000000000000",
    behaviors: ["standard"],
    controls: []
  },
  {
    id: "strategy-target",
    role: "other",
    origin: "existing-erc20",
    address: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
    decimals: 18,
    decimalsSource: "token-contract-observation",
    supplyPolicy: "externally-managed",
    initialSupply: null,
    behaviors: ["standard"],
    controls: []
  }
];
s.pool.currency0 = "eth";
s.pool.currency1 = "launched-token";
s.pool.orderingRule = "Native ETH is currency0 and the configured launched token is currency1.";
s.pool.tickSpacing = 200;
s.pool.lpFee.mode = "static";
s.pool.lpFee.hundredthsOfBip = 0;
s.pool.lpFee.recipient = "pool-liquidity-providers";
s.pool.canonical = true;
s.pool.alternativePools = "Alternative pools may exist but are not canonical, accrue no liability in this hook and do not inherit its strategy behavior.";

s.hook.used = true;
s.hook.base = "Pinned OpenZeppelin BaseHook at commit 26dc8e53f812a1ca390d470342adb6cd8c3286ad.";
s.hook.upgradeable = false;
s.hook.sharedAcrossPools = false;
s.hook.poolNamespace = "One immutable hook instance is bound to one exact canonical PoolId; every liability also names native currency and beneficiary role.";
s.hook.poolAdmission = {
  enforcement: "Constructor-derived canonical PoolKey and PoolId are recomputed and checked in every callback.",
  factoryOrRegistry: "Permissionless V4StrategyHookFactory deploys CREATE2 instances; only the immutable creator initializes the resulting exact PoolKey.",
  alternativePoolBehavior: "Alternative PoolKeys cannot pass callback admission and cannot read or mutate this instance's liabilities.",
  rejectionRule: "Wrong token, currency order, fee, tick spacing, hook address or PoolId reverts before state changes."
};
s.hook.permissions = {
  beforeInitialize: true,
  afterInitialize: false,
  beforeAddLiquidity: false,
  afterAddLiquidity: false,
  beforeRemoveLiquidity: false,
  afterRemoveLiquidity: false,
  beforeSwap: true,
  afterSwap: true,
  beforeDonate: false,
  afterDonate: false,
  beforeSwapReturnDelta: true,
  afterSwapReturnDelta: true,
  afterAddLiquidityReturnDelta: false,
  afterRemoveLiquidityReturnDelta: false
};
s.hook.callbackPolicies = [
  callback("beforeInitialize", "Authenticate the immutable creator and exact canonical PoolKey before initialization."),
  callback("beforeSwap", "Charge native ETH when quote is specified and mint the exact claim backing before returning the specified delta."),
  callback("afterSwap", "Charge actual native ETH when quote is unspecified and verify specified-native swaps were not partially filled.")
];
s.hook.hookData = { used: false, schema: null, identitySource: null, trustedRouterDeploymentRecordId: null, callbackSenderRule: null, validation: null };
s.hook.feeMechanism = {
  used: true,
  classification: "hook-owned-fee",
  chargedCurrency: "Native ETH currency0, the canonical quote asset, in every supported swap quadrant.",
  swapQuadrants: {
    zeroForOneExactInput: quadrant("gross-input"),
    zeroForOneExactOutput: quadrant("gross-input"),
    oneForZeroExactInput: quadrant("gross-output"),
    oneForZeroExactOutput: quadrant("gross-output")
  },
  maximumHundredthsOfBip: 100000,
  collectionPath: "quadrant-dependent-swap-return-delta",
  collectionValueFlowId: "canonical-native-fee-accrual",
  liabilityKeyDimensions: ["poolId", "currency", "beneficiary"],
  collectionEvent: "NativeFeesAccrued(bytes32,address,bool,uint16,uint256,uint256,uint256,uint256)",
  recipients: [
    { role: "programmable-platform", sharePpm: 100000, addressSource: "fixed-address", address: platformOwner, binding: "exact-address", derivationRule: null, mutable: false, mutationController: "none", newAddressValidation: "none", mutationEvent: null },
    { role: "strategy", sharePpm: 90000, addressSource: "derived-contract", address: null, binding: "immutable-derived-contract", derivationRule: "The CREATE2-deployed hook itself owns this claim partition and can spend it only through executeStrategy.", mutable: false, mutationController: "none", newAddressValidation: "none", mutationEvent: null },
    { role: "creator", sharePpm: 810000, addressSource: "beneficiary-supplied", address: null, binding: "beneficiary-at-launch", derivationRule: null, mutable: false, mutationController: "none", newAddressValidation: "none", mutationEvent: null }
  ],
  ownership: "Programmable, creator and strategy liabilities are immutable partitions; no owner, factory, keeper or administrator can redirect another partition.",
  claimPolicy: "Creator claims only to itself; Programmable owner claims only its liability to a destination it selects per call; strategy has no claim path."
};
s.hook.customAccounting = {
  used: true,
  backingSource: "Every positive fee return delta mints an equal native ERC-6909 claim owned by this one-pool hook.",
  conservationEquation: "programmableFeesAccrued + creatorFeesAccrued + strategyFeesAccrued = totalNativeLiabilities <= PoolManager native claims owned by hook.",
  settlement: "Fee callbacks mint claims; claims burn during beneficiary redemption or the exact-input strategy swap; target output is taken and burned before transaction completion.",
  partialFillBehavior: "Unspecified-native paths use actual PoolManager deltas; specified-native partial fills revert after exact adjusted-leg verification.",
  liabilityNamespace: "The one-pool instance binds chain, model version, canonical PoolId, native currency and beneficiary role.",
  liabilityKeyDimensions: ["chainId", "modelVersion", "poolId", "currency", "beneficiary"],
  crossPoolNetting: false,
  duplicateCurrencyPolicy: "One hook instance serves one canonical PoolId; a different instance has separate claim ownership even for native ETH.",
  failureIsolation: "Any return-delta, claim, cross-pool swap or burn failure reverts all effects and cannot consume another liability.",
  withdrawalOrdering: "The exact beneficiary liability is decremented before PoolManager unlock and the decrement reverts if redemption fails."
};
s.hook.returnDeltaAccounting = {
  used: true,
  quadrants: {
    zeroForOneExactInput: beforeQuadrant("currency0", "currency1", "negative-exact-input"),
    zeroForOneExactOutput: afterQuadrant("currency1", "currency0", "positive-exact-output"),
    oneForZeroExactInput: afterQuadrant("currency1", "currency0", "negative-exact-input"),
    oneForZeroExactOutput: beforeQuadrant("currency0", "currency1", "positive-exact-output")
  },
  executionEvent: "NativeFeesAccrued reports PoolId, router sender, direction, effective rate, gross native volume and all three liabilities."
};
s.hook.postReturnDeltaAccounting.afterSwap = {
  used: true,
  returnedDeltaShape: "unspecified-currency-int128",
  positiveMeaning: "hook-credit-caller-debit",
  negativeMeaning: "hook-debt-caller-credit",
  backingSource: "The hook mints an equal native claim before returning a positive unspecified fee delta.",
  callerDeltaEquation: "protocol-delta-minus-hook-delta",
  componentPolicies: { unspecified: feeComponent("unspecified"), currency0: null, currency1: null },
  bounds: "Zero through ten percent of verified gross native quote volume, never the complete swap amount.",
  rounding: "Gross fees round down; exact-output gross-up rounds upward before exact partition.",
  slippageOrMinimums: "Router final deltas include the hook fee; strategy slippage is independently immutable and internally derived.",
  failureRule: "Calculation, claim mint or partial-fill verification failure reverts the complete swap.",
  executionEvent: s.hook.feeMechanism.collectionEvent
};
s.hook.postReturnDeltaAccounting.afterAddLiquidity.used = false;
s.hook.postReturnDeltaAccounting.afterRemoveLiquidity.used = false;
s.hook.erc6909Claims = {
  used: true,
  currencyIdDerivation: "currency-address-uint160",
  claimBalanceScope: "claim-owner-and-currency",
  poolIdIncludedInClaimId: false,
  owner: "The one-pool V4StrategyHook owns native-currency PoolManager claims; PoolId attribution is enforced by immutable instance configuration and liabilities.",
  operatorPolicy: "No operator approval is granted; only the hook burns its own claims during authenticated unlock callbacks.",
  mintFlow: "Each canonical fee return delta calls PoolManager mint through CurrencySettler.take with claims=true for the exact fee.",
  burnFlow: "Creator and Programmable claims burn only their decremented amount; strategy execution burns only strategyFeesAccrued as target-pool input.",
  takeSettleFlow: "Strategy burns native claims to settle its target-pool debt, then takes the exact target-token credit as ERC-20 before burning it.",
  liabilityKeys: "canonical PoolId, native currency and one of programmable, creator or strategy; one instance never serves another PoolId.",
  liabilityKeyDimensions: ["chainId", "modelVersion", "poolId", "currency", "beneficiary"],
  crossPoolNetting: false,
  transferPolicy: "ERC-6909 claims never transfer to arbitrary users; they are minted to and burned from the hook only.",
  redemption: "Beneficiary redemption burns an exact native claim and takes equal native ETH to the authorized destination.",
  roundingDust: "Creator receives project partition remainder; any direct donation creates no liability and cannot be swept.",
  aggregateSolvencyEquation: "totalNativeLiabilities equals the sum of three liabilities and never exceeds PoolManager.balanceOf(hook,nativeCurrencyId)."
};
s.hook.nestedActions = {
  used: true,
  directPoolManagerCalls: true,
  routerCalls: false,
  allowedActions: ["swap", "take", "settle", "mint-claim", "burn-claim"],
  samePoolPolicy: "Canonical-pool self-swaps are forbidden; target PoolId must differ and target hook cannot equal this hook.",
  crossPoolPolicy: "executeStrategy may swap only the immutable native-ETH/target-token PoolKey stored at construction.",
  callbackSuppression: "The canonical hook receives no callback for its direct target-pool call; the target pool's separate hook still executes normally.",
  directCallbackBehavior: "self-call-hook-callbacks-skipped",
  routerCallbackBehavior: null,
  maximumDepth: 1,
  stateCommitOrder: "Decrement strategy and total liabilities before unlock; settle native debt, take target credit, then transfer exact target output to the fixed dead address.",
  transientDeltaOwner: "V4StrategyHook owns every target-pool delta within its PoolManager unlock callback.",
  syncInterleaving: "Native claim burn settles input without sync; target credit is taken before unlock returns.",
  slippageAggregation: "TWAP minimum output and spot price-impact limit both apply to the single immutable target-pool hop.",
  failureAtomicity: "Any target callback, settlement, output, transfer or exact-burn mismatch reverts the complete transaction and restores liabilities."
};

s.programmableFee.rates.selectedHundredthsOfBip = 10000;
s.programmableFee.rates.effectiveHundredthsOfBip = 10000;
s.programmableFee.rates.projectHundredthsOfBip = 9000;
s.programmableFee.collection.status = "implemented";
s.programmableFee.collection.supportedSwapModes = modes;
s.programmableFee.collection.swapModePaths = {
  zeroForOneExactInput: "before-swap-return-delta",
  zeroForOneExactOutput: "after-swap-return-delta",
  oneForZeroExactInput: "after-swap-return-delta",
  oneForZeroExactOutput: "before-swap-return-delta"
};
s.programmableFee.collection.selfCallPolicy = "same-pool-swap-fee-enforced-internally";
s.programmableFee.accounting.valueFlowId = "canonical-native-fee-accrual";
s.programmableFee.accounting.collectionEvent = s.hook.feeMechanism.collectionEvent;
s.programmableFee.accounting.claimEvent = "ProgrammableFeesClaimed(address indexed recipient,uint256 amount)";
s.programmableFee.evidence.sourcePaths = ["src/V4StrategyHook.sol"];
s.programmableFee.evidence.testPaths = ["test/V4StrategyHook.t.sol", "test/V4StrategyHookInvariant.t.sol"];

s.capabilities.externalCalls = {
  used: true,
  targets: ["immutable Uniswap v4 PoolManager", "immutable target PoolKey hook", "immutable standard ERC-20 target token"],
  callSites: ["claim redemption unlock", "executeStrategy target-pool swap", "target balance reads and exact transfer to dead address"],
  reentrancyPolicy: "Transient nonReentrant guards all claims and execution; PoolManager-only unlock callback; target hook cannot equal this hook.",
  stateDriftPolicy: "Pool and token identities are immutable; stale oracle or changed token behavior fails closed.",
  returnValuePolicy: "PoolManager calls must settle deltas; SafeERC20 and exact before/after balances validate target transfer.",
  failureAtomicity: "Every external-call failure reverts the complete claim or strategy action and restores effects."
};
s.capabilities.oracle = {
  used: true,
  source: "Immutable target v4 PoolId slot0 ticks sampled into a 16-observation onchain ring.",
  value: "Time-weighted average target-token-per-native-ETH tick plus current spot tick.",
  deployment: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  runtimeHash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  decimals: 0,
  heartbeatSeconds: 300,
  maxAgeSeconds: 600,
  observationType: "twap",
  windowSeconds: 1800,
  minimumAnswer: "TickMath.MIN_TICK",
  maximumAnswer: "TickMath.MAX_TICK",
  maximumDeviation: "Immutable maximum spot-to-TWAP tick deviation and separate price-impact ticks.",
  roundChecks: "Require initialized target pool, complete window, bounded gaps, safe signed cumulative arithmetic and nonzero minimum output.",
  manipulationResistance: "Instant spot movement cannot rewrite historical cumulative time; sustained manipulation and sparse sampling remain explicit economic risks.",
  governance: "All oracle cadence, window and deviation parameters are constructor-bound and immutable.",
  fallback: "revert",
  maxFallbackAgeSeconds: 0,
  failureRule: "Reset history after an excessive gap and block strategy execution until a complete fresh window exists."
};
s.capabilities.keeper = {
  used: true,
  executionMode: "permissionless",
  minIntervalSeconds: 300,
  maxDelaySeconds: 600,
  permissionlessFallbackAfterSeconds: 0,
  idempotencyKey: "chainId, hook address, latest observation timestamp, executionCount and strategyFeesAccrued",
  duplicateBehavior: "Too-frequent observations revert; duplicate execution sees zero strategy work or active cooldown and sends no value.",
  lastProcessedState: "Read directly from hook observation and execution state each cycle; no offchain state is authoritative.",
  boundedWork: "At most one observation transaction and one complete strategy transaction per cycle.",
  maxItems: 2,
  retryPolicy: "Simulate every action, retry only on the next bounded cycle and alert rather than weakening safety parameters.",
  zeroWorkBehavior: "Log status and submit no execution transaction when threshold or cooldown is not ready.",
  fundingSource: "A dedicated low-value gas-only EOA; no protocol reimbursement or allowance.",
  minimumGasRunway: "Operator-defined alert before the EOA cannot fund two maximum configured cycles.",
  alertThreshold: "Observation age approaching maximum gap, repeated simulation failure or insufficient gas runway.",
  maximumGas: 1000000,
  failureImpact: "Execution may be delayed and the oracle may reset; liabilities remain backed and any address can restore observations and execute.",
  userExitIndependent: true,
  poolBinding: "Exact configured hook address, chain ID, canonical PoolId and immutable target PoolId.",
  slippage: "No keeper-supplied value; the contract derives the immutable TWAP output floor and impact limit.",
  deadline: "Each transaction is simulated at latest state and sent for immediate inclusion; stale state reverts onchain.",
  mevPolicy: "Public execution is allowed; private relay is optional, while onchain TWAP, deviation, slippage and impact checks remain mandatory."
};
s.capabilities.externalLiquidity = {
  used: true,
  custody: "The strategy never owns target-pool LP positions; it temporarily receives only purchased target output before burning it.",
  ownership: "Target-pool liquidity belongs to its LPs and is an immutable external execution dependency.",
  shareAccounting: "Not used; the hook tracks no target-pool shares or LP entitlement.",
  solvencyEquation: "Strategy native input equals the decremented strategy liability; target output is taken and burned exactly in one transaction.",
  lossAllocation: "Price movement affects output within immutable bounds; execution outside bounds reverts and retains the strategy liability.",
  donationPolicy: "Target-pool donations affect ordinary pool state; direct target-token donations to the hook create no liability and cannot be swept.",
  exitPath: "No hook-owned LP position exists; strategy liability stays retryable if target liquidity disappears.",
  dependencyFailure: "Target pool, hook or token failure blocks execution but cannot redirect or consume the retained liability."
};
s.capabilities.permissionedAsset.used = false;
s.capabilities.proof.used = false;
s.capabilities.crossChain.used = false;
s.capabilities.asyncSwap.used = false;
s.capabilities.customCurve.used = false;

s.integration.swapModes = modes;
s.integration.partialFills = "Unspecified-native fees use actual executed PoolManager deltas; specified-native partial fills revert because before-swap fee claims cannot be safely refunded after execution.";
s.integration.slippage = "User routing checks final fee-adjusted deltas; strategy execution separately derives minimum output from immutable TWAP/slippage and price-impact settings.";
s.integration.deadline = "User router deadlines remain route-defined; strategy execution uses current onchain state and reverts atomically if any safety bound no longer holds.";
s.integration.permit2 = "No included swap client exists; external clients own their exact Permit2 approval and signature policy.";
s.integration.stateReads = "PoolManager slot0, claims, liabilities and observations are read for exact immutable PoolIds at a coherent block.";
s.integration.events = [
  s.hook.feeMechanism.collectionEvent,
  "ProgrammableFeesClaimed(address indexed recipient,uint256 amount)",
  "CreatorFeesClaimed(address indexed creator,uint256 amount)",
  "OracleObservation(uint32 indexed timestamp,int24 tick,int56 tickCumulative,bool reset)",
  "StrategyExecuted(address indexed executor,uint256 nativeAmountIn,uint256 targetAmountBurned,int24 twapTick,int24 spotTick,uint256 minimumOutput)",
  "StrategyHookDeployed(address indexed hook,address indexed creator,address indexed launchToken,address targetToken,bytes32 salt,bytes32 configurationHash)"
];
s.integration.routingAndDiscoverability.routingMode = "not-planned";
s.integration.routingAndDiscoverability.allowlistTriggers.usesDeltaFlag = true;
s.integration.routingAndDiscoverability.allowlistTriggers.permissionedPool = false;
s.integration.routingAndDiscoverability.uniswapRoutingStatus = "not-applicable";
s.integration.routingAndDiscoverability.hookRegistryStatus = "not-submitted";
s.integration.routingAndDiscoverability.customHookDataRequired = false;
s.integration.routingAndDiscoverability.standardRouterCompatible = true;
s.integration.routingAndDiscoverability.sourcePaths = [];
s.integration.routingAndDiscoverability.testPaths = [];
s.integration.routerDependencyId = null;
s.integration.routerGeneration = null;
s.integration.permit2DependencyId = null;
s.integration.stateViewDependencyId = null;
s.integration.quoterDependencyId = null;
s.integration.sdkDependencies = [
  {
    packageName: "viem",
    version: "2.55.10",
    integrity: "sha512-Q9Ba+/ma81U2M5o5P2AQ7Ux8rTIwmCZvUcr8rKdQ22bV0IBFHllM2m5gWDP8hFaUN2nH2oW3QG44amRazflYNQ==",
    repository: "https://github.com/wevm/viem.git",
    revision: "fe2bce6cc4d689d18a0d95b4ae818afc661becf1"
  }
];
s.integration.routerActionProfile = { routerVersionExplicit: null, universalRouterCommand: null, v4Actions: [], settlementMode: null, permit2Mode: null, finalSwapDeltaValidated: null };
s.integration.appSourcePaths = [];
s.integration.integrationTestPaths = [];
s.integration.quoteExecutionParity = null;
s.integration.dataReconstruction.eventCoverage = "NativeFeesAccrued reconstructs liability increases; claim events reconstruct authorized decreases; StrategyExecuted reconstructs strategy decrease and burn; confirmed claim reads reconcile backing.";
s.integration.dataReconstruction.balanceSources = undefined;
s.integration.dataReconstruction.reserveReconstruction.used = true;
s.integration.dataReconstruction.reserveReconstruction.balanceSources = ["PoolManager.balanceOf(hook,nativeCurrencyId) at one confirmed block"];
s.integration.dataReconstruction.reserveReconstruction.liabilitySources = ["Three liability views plus NativeFeesAccrued, claim events and StrategyExecuted"];
s.integration.dataReconstruction.reserveReconstruction.attributionKeys = ["poolId", "currency", "beneficiary"];
s.integration.dataReconstruction.reserveReconstruction.solvencyEquation = "Native PoolManager claims owned by the hook must be at least totalNativeLiabilities, which equals all three partitions.";
s.integration.dataReconstruction.reserveReconstruction.poolLiquidityTreatment = "excluded-from-hook-reserves";
s.integration.dataReconstruction.reserveReconstruction.donationAndDustPolicy = "Direct donations create no liability and are excluded; no sweep or attribution path exists.";
s.integration.dataReconstruction.reserveReconstruction.reconciliation = "Replay finalized events, compare all liability views with totalNativeLiabilities and PoolManager claims, and withhold inconsistent results.";
s.integration.dataReconstruction.sourcePaths = ["indexer/src/reconstruct.mjs"];
s.integration.dataReconstruction.testPaths = ["indexer/test/reconstruct.test.mjs"];
s.integration.platformHandoff.intended = true;
s.integration.platformHandoff.reviewStatus = "not-requested";
s.integration.platformHandoff.maintainerReviewRequired = true;
s.integration.platformHandoff.selfApproval = false;
s.integration.platformHandoff.availabilityClaimed = false;
s.integration.platformHandoff.handoffNotes = "The contributor supplies an isolated hook, factory, keeper and review package; Programmable maintainers independently decide any registry, UI, API, indexer or routing integration.";

s.operations.keeper = {
  required: true,
  actor: "Any EOA; the included optional process uses a dedicated gas-only EOA.",
  action: "Record target-pool observations and call permissionless executeStrategy only after local eth_call simulation.",
  cadence: "Prototype defaults to five-minute polling; immutable deployment configuration controls safe observation and execution cadence.",
  authentication: "No contract role; chain ID and hook bytecode are checked before simulation.",
  funding: "Gas-only EOA funded outside protocol value.",
  failure: "Delay or oracle reset only; liabilities remain backed and retryable.",
  fallback: "Any address can call the same methods immediately."
};
s.operations.oracle = {
  required: true,
  actor: "Any address records samples; hook reads immutable target PoolId slot0.",
  action: "Maintain bounded cumulative ticks and reject strategy execution without a complete fresh window.",
  cadence: "Constructor-configured minimum spacing and maximum gap; demo is five and ten minutes with a thirty-minute window.",
  authentication: "No caller trust; value source is immutable PoolManager target PoolId state.",
  funding: "Observation callers pay gas; no reimbursement.",
  failure: "Excessive gap resets history and blocks execution without consuming liabilities.",
  fallback: "No price fallback; fail closed until fresh history exists."
};
s.operations.monitoring = "Index all fee, claim, observation and strategy events; reconcile three liabilities against totalNativeLiabilities and PoolManager claims; alert on stale oracle, repeated execution reverts or keeper gas runway.";
s.operations.incidentResponse = "The immutable hook has no pause, rescue or upgrade. Stop new deployments, publish exact affected PoolIds, preserve claims, restore observations when safe and require a separately reviewed version for future pools.";

s.risk = {
  dimensions: { complexity: 5, customMath: 2, externalDependencies: 3, externalLiquidity: 2, valueAtRisk: 3, teamMaturity: 1, upgradeability: 0, autonomy: 2, priceImpact: 3 },
  rationales: {
    complexity: "The model combines four-quadrant return deltas, ERC-6909 liabilities, cross-pool execution, a sampled oracle, exact burn checks and permissionless operations.",
    customMath: "Fee gross-up, tick cumulative averaging and tick-to-quote conversion use pinned bounded math but require independent review.",
    externalDependencies: "PoolManager, target PoolKey hook, target liquidity and target ERC-20 behavior can all block execution.",
    externalLiquidity: "Strategy output depends on a separate target pool whose depth and hook behavior are outside this contract.",
    valueAtRisk: "Accrued native claims remain in the hook until claims or strategy execution; expected production value is not yet established.",
    teamMaturity: "Local tests exist, but no independent audit, public review history or incident drill has completed.",
    upgradeability: "Hook, recipients, fees, oracle bounds, target and burn rule are immutable with no proxy or admin.",
    autonomy: "Anyone can trigger bounded observation and strategy state transitions, while no caller can change parameters or recipients.",
    priceImpact: "Strategy execution trades against external liquidity and is protected only within explicit TWAP, deviation, slippage and impact bounds."
  },
  declaredTotal: 21,
  declaredTier: "high",
  featureTriggers: ["autonomous", "custom-accounting", "custom-math", "external-calls", "external-liquidity", "hook-held-liquidity", "oracle", "price-impact", "project-custody", "project-external-calls", "project-value-flow", "return-delta"]
};

s.valueFlows = [
  { id: "canonical-native-fee-accrual", action: "accrue inclusive canonical-pool fee", asset: "native ETH PoolManager claims", from: "verified gross native quote-side volume", to: "Programmable, creator and strategy liabilities", amountRule: "effective=max(selected,10 bps); exactly 10 bps platform; project remainder split by immutable strategyShareBps.", settlement: "Quadrant-dependent fee return delta mints an equal native claim before callback return.", failure: "Any calculation, partial-fill verification or mint failure reverts the complete swap." },
  { id: "beneficiary-native-claim", action: "redeem platform or creator liability", asset: "native ETH", from: "hook-owned native PoolManager claim", to: "authorized immutable beneficiary or platform owner-selected per-call destination", amountRule: "Redeem only the selected liability's full current amount.", settlement: "Decrease liability, burn equal claim, take equal native ETH.", failure: "Unauthorized, zero or failed redemption reverts without changing another liability." },
  { id: "strategy-buyback-burn", action: "buy and burn immutable target token", asset: "native ETH claim and target ERC-20", from: "strategyFeesAccrued through immutable target PoolKey", to: "fixed dead address", amountRule: "Spend all strategy liability only after threshold, cooldown, TWAP, deviation, slippage and impact checks.", settlement: "Burn native claim for input, take exact target credit, transfer exact output to dead address and verify balances.", failure: "Any dependency, oracle, price, transfer or exact-burn mismatch reverts the whole transaction and restores liability." }
];
s.authorities = [];
s.dependencies = {
  onchain: [
    {
      id: "poolmanager-ethereum",
      name: "Uniswap v4 PoolManager on Ethereum",
      kind: "Uniswap v4 PoolManager",
      repository: "https://github.com/Uniswap/v4-core.git",
      revision: "e50237c43811bd9b526eff40f26772152a42daba",
      packageVersion: null,
      license: "file-specific MIT or BUSL-1.1",
      sourceProvenance: "verified-explorer-source",
      deploymentRecordId: "v4-poolmanager-ethereum",
      chainAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      runtimeHash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
      deploymentEvidencePath: "submissions/v4-strategy-hook/evidence/deployment-poolmanager.json",
      trust: "Official Uniswap deployment record, independently observed runtime hash, and 43/43 exact Blockscout verified-source matches to Uniswap v4.0.0.",
      failure: "Missing or mismatched PoolManager runtime blocks fork and deployment preparation; every PoolManager interaction otherwise fails atomically.",
      fallback: "No alternate PoolManager or bytecode fallback is permitted."
    }
  ],
  offchain: [
    {
      id: "v4-core-source",
      name: "Uniswap v4 Core compile-time source",
      kind: "Solidity library",
      repository: "https://github.com/Uniswap/v4-core.git",
      revision: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
      packageVersion: null,
      license: "file-specific MIT or BUSL-1.1",
      sourceProvenance: "pinned-source",
      deploymentRecordId: null,
      chainAddress: null,
      runtimeHash: null,
      deploymentEvidencePath: null,
      trust: "Pinned Git commit and source-tree hash in the dependency lock.",
      failure: "Compilation or import-closure verification fails closed.",
      fallback: "No floating branch or package fallback."
    },
    {
      id: "v4-periphery-source",
      name: "Uniswap v4 Periphery compile-time source",
      kind: "Solidity library",
      repository: "https://github.com/Uniswap/v4-periphery.git",
      revision: "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
      packageVersion: null,
      license: "MIT",
      sourceProvenance: "pinned-source",
      deploymentRecordId: null,
      chainAddress: null,
      runtimeHash: null,
      deploymentEvidencePath: null,
      trust: "Pinned Git commit and source-tree hash in the dependency lock.",
      failure: "Compilation or CREATE2 hook-address derivation fails closed.",
      fallback: "No floating branch or package fallback."
    },
    {
      id: "openzeppelin-uniswap-hooks-source",
      name: "OpenZeppelin Uniswap Hooks",
      kind: "Solidity library",
      repository: "https://github.com/OpenZeppelin/uniswap-hooks.git",
      revision: "26dc8e53f812a1ca390d470342adb6cd8c3286ad",
      packageVersion: null,
      license: "MIT",
      sourceProvenance: "pinned-source",
      deploymentRecordId: null,
      chainAddress: null,
      runtimeHash: null,
      deploymentEvidencePath: null,
      trust: "Pinned Git commit and source-tree hash in the dependency lock.",
      failure: "Compilation or hook callback authentication fails closed.",
      fallback: "No floating branch or package fallback."
    },
    {
      id: "openzeppelin-contracts-source",
      name: "OpenZeppelin Contracts",
      kind: "Solidity library",
      repository: "https://github.com/OpenZeppelin/openzeppelin-contracts.git",
      revision: "21c8312b022f495ebe3621d5daeed20552b43ff9",
      packageVersion: null,
      license: "MIT",
      sourceProvenance: "pinned-source",
      deploymentRecordId: null,
      chainAddress: null,
      runtimeHash: null,
      deploymentEvidencePath: null,
      trust: "Pinned Git commit and source-tree hash in the dependency lock.",
      failure: "Compilation or SafeERC20 execution fails closed.",
      fallback: "No floating branch or package fallback."
    },
    {
      id: "forge-std-source",
      name: "Forge Standard Library",
      kind: "Solidity test library",
      repository: "https://github.com/foundry-rs/forge-std.git",
      revision: "3b20d60d14b343ee4f908cb8079495c07f5e8981",
      packageVersion: null,
      license: "MIT or Apache-2.0",
      sourceProvenance: "pinned-source",
      deploymentRecordId: null,
      chainAddress: null,
      runtimeHash: null,
      deploymentEvidencePath: null,
      trust: "Pinned Git commit and source-tree hash in the dependency lock.",
      failure: "The test harness cannot compile or execute.",
      fallback: "No floating branch or package fallback."
    },
    {
      id: "solmate-source",
      name: "Solmate",
      kind: "Transitive Solidity test library",
      repository: "https://github.com/transmissions11/solmate.git",
      revision: "4b47a19038b798b4a33d9749d25e570443520647",
      packageVersion: null,
      license: "AGPL-3.0",
      sourceProvenance: "pinned-source",
      deploymentRecordId: null,
      chainAddress: null,
      runtimeHash: null,
      deploymentEvidencePath: null,
      trust: "Pinned Git commit and source-tree hash in the dependency lock; test-only transitive dependency.",
      failure: "The upstream test utility closure cannot compile.",
      fallback: "No floating branch or package fallback."
    }
  ]
};
s.implementation = {
  sourcePaths: [
    "src/V4StrategyHook.sol",
    "src/V4StrategyHookFactory.sol",
    "keeper/src/keeper.mjs",
    "keeper/src/policy.mjs",
    "indexer/src/reconstruct.mjs"
  ],
  testPaths: [
    "test/V4StrategyHook.t.sol",
    "test/V4StrategyHookInvariant.t.sol",
    "test/V4StrategyHookFork.t.sol",
    "keeper/test/policy.test.mjs",
    "indexer/test/reconstruct.test.mjs"
  ],
  compilerBuildInfoPaths: ["submissions/v4-strategy-hook/evidence/build-info/1673e411da065ae2.json"],
  specificationPath: "spec/SPECIFICATION.md",
  testEvidencePath: "submissions/v4-strategy-hook/evidence/test-evidence.json",
  dependencyLockPath: "dependencies/compatibility.lock.json",
  gateStatusPath: "submissions/v4-strategy-hook/evidence/gate-status.json",
  reviewTargetPath: "submissions/v4-strategy-hook/evidence/review-target.json",
  runtimeAssetManifestPath: null
};
s.unresolved = [];

const surface = s.projectSurfaces[0];
surface.name = "V4 Strategy Hook contracts";
surface.summary = "One canonical-pool hook, permissionless CREATE2 factory, PoolManager claims, sampled target-pool oracle and atomic buyback/burn execution.";
surface.capabilityIds = ["canonical-pool-state"];
surface.valueFlowRefs = s.valueFlows.map((flow) => flow.id);
surface.assetRefs = ["eth", "launched-token", "strategy-target"];
surface.sourcePaths = s.implementation.sourcePaths;
surface.testPaths = s.implementation.testPaths;
surface.schemaPaths = ["spec/SPECIFICATION.md"];
surface.evidencePaths = [
  "submissions/v4-strategy-hook/EVIDENCE.md",
  "submissions/v4-strategy-hook/STATIC_ANALYSIS.md",
  "submissions/v4-strategy-hook/evidence/slither.json",
  "submissions/v4-strategy-hook/evidence/deployment-poolmanager.json",
  "submissions/v4-strategy-hook/evidence/test-evidence.json",
  ".gas-snapshot"
];
surface.exposure.movesValue = true;
surface.exposure.makesExternalCalls = true;
surface.exposure.holdsCustody = true;
for (const profileName of ["valueFlow", "externalCalls", "custody"]) {
  surface.profiles[profileName].status = "applicable";
  surface.profiles[profileName].summary = "The hook moves and temporarily custodies exact PoolManager claims or target output under the immutable value flows and atomic failure rules.";
  surface.profiles[profileName].controls = ["Reconcile exact liabilities, external calls and burn output through source, tests and finalized events."];
}
const capability = s.projectCapabilities[0];
capability.summary = "Enforce canonical-pool fees, claims, sampled target price safety and permissionless exact buyback/burn without mutable administration.";
capability.securityTriggers.valueFlow = true;
capability.securityTriggers.externalCalls = true;
capability.securityTriggers.custody = true;
capability.requiredProfiles = ["authority", "value-flow", "source-of-truth", "external-calls", "custody", "failure-recovery", "source-test-schema"];

fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
