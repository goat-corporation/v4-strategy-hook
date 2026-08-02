# V4 Strategy Hook

An isolated Uniswap v4 prototype for Programmable launches that turns a configurable share of canonical-pool quote
volume into permissionless, oracle-guarded buybacks and irreversible burns.

This repository is a Hookathon prototype. It is **not deployed, audited, accepted, routed, or available through the
Programmable launchpad**. It does not modify the live V4STR token, its existing pool, or its current worker.

## What it does

Each hook instance is bound to one native-ETH launch pool and one separate native-ETH target pool. The creator chooses
the following once, at deployment:

- launch token, creator, canonical LP fee, and tick spacing;
- independent buy and sell hook-fee totals, from the 10 bps floor through 10%;
- the percentage of the project remainder assigned to strategy versus creator;
- target token and exact v4 target PoolKey;
- execution threshold and cooldown;
- oracle window, sampling bounds, maximum TWAP deviation, slippage, and price impact.

After deployment those values cannot change. The hook has no owner, proxy, pause, rescue, sweep, arbitrary call, mutable
recipient, or privileged keeper.

The Programmable rule is fixed: the selected total is inclusive, the effective total is
`max(selected total, 10 bps)`, and exactly 10 bps belongs to the immutable Programmable fee owner. The remaining
project fee is split between creator and strategy. For the V4STR demonstration, a 1% total fee and a 10/90
strategy/creator split yields:

```text
1.00% total hook fee
├─ 0.10% Programmable
└─ 0.90% project remainder
   ├─ 0.09% buyback and burn (10% of project remainder)
   └─ 0.81% creator (90% of project remainder)
```

All percentages are separate from the LP fee.

## Safety model

- All four direction/exactness quadrants charge executed native-ETH quote volume.
- Native fees are held as PoolManager ERC-6909 claims; liabilities must remain exactly partitioned and backed.
- Programmable can claim only its liability, to a destination selected for that claim.
- The creator can claim only its liability, directly to its immutable address.
- Strategy execution is callable by anyone and always spends the full strategy liability as exact input.
- The caller cannot select the target, recipient, amount, route, `minOut`, or price limit.
- An onchain sampled TWAP, maximum spot deviation, output floor, and price-impact limit all fail closed.
- The target pool must be separate. Same-pool self-swaps are forbidden.
- Exact purchased output is transferred to `0x000000000000000000000000000000000000dEaD`; fee-on-transfer or malformed
  target tokens revert.
- Failed execution restores the complete liability and can be retried.

The oracle is a bounded sampled oracle, not a guarantee against market manipulation. It requires recurring observations,
and its economic assumptions require independent review before any deployment.

## Build and test

Requirements: Foundry, Git, and Node.js 20 or newer.

```bash
./scripts/bootstrap-deps.sh
forge build --sizes
forge test --offline -vv
```

Pinned commits live in [`dependencies/compatibility.lock.json`](dependencies/compatibility.lock.json). `--offline`
also avoids Foundry's optional signature lookup and makes the local suite deterministic.

The test suite covers configuration, CREATE2 permission bits, the mandatory fee floor, V4STR's 10/90 project split,
all four swap quadrants, isolated claims, callback authentication, stale-oracle failure, exact buyback/burn, fee
conservation fuzzing, and mixed-swap solvency invariants.

## Optional keeper

[`keeper/`](keeper/) provides a dry-run-first Viem process. It has no special authority and exists only to record
observations and call the same permissionless execution function available to everyone. Use a gas-only key, never a
creator or treasury key.

## Repository map

```text
src/V4StrategyHook.sol             hook, accounting, oracle and strategy execution
src/V4StrategyHookFactory.sol      permissionless CREATE2 factory
test/V4StrategyHook.t.sol          unit and lifecycle tests
test/V4StrategyHookInvariant.t.sol stateful solvency tests
keeper/                            optional unprivileged automation
spec/                              locked architecture and security properties
submissions/v4-strategy-hook/      Programmable review package
```

## Existing V4STR proof of demand

- V4STR: `0x6d7ae59eb1fbef5bcb7d52064279b1e003caba1a`
- current deployer: `0x99205545b36cFdb42691AD8438e9fcD037AFF132`
- demonstration target V4: `0x7987f03462200b3D8A072E02C89A8A41dCB124EE`
- site: <https://v4str.fun>

These addresses provide product context only. The prototype does not call the live V4STR deployer, does not contain its
private key, and is not wired to its live pool.

## License and status

Model-owned source is MIT licensed; imported dependencies retain their own licenses. No independent audit has been
completed. A deployment, public repository, PR, Hooklist request, launchpad integration, or mainnet transaction requires
separate explicit authorization and evidence.
