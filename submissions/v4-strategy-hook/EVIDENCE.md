# Evidence

## Current local evidence

| Claim | Evidence | State |
| --- | --- | --- |
| Source exists | `src/V4StrategyHook.sol`, `src/V4StrategyHookFactory.sol` | Complete locally |
| Dependencies pinned | `dependencies/compatibility.lock.json`, `scripts/bootstrap-deps.sh` | Complete locally |
| Compiles | Solidity 0.8.26, Cancun, optimizer 200 | Passed locally |
| Size | Hook runtime approximately 18.6 kB; initcode approximately 22.3 kB; factory runtime approximately 23.9 kB | Below EVM limits locally |
| Repository tests | `forge test --force --offline --no-match-path 'test/V4StrategyHookFork.t.sol' -vv` | 35 reported test/property entries passed |
| Fuzz | Fee conservation, 10,000 runs in CI profile | Passed locally |
| Invariants | Three 1,000-run, depth-128 mixed-swap properties; 384,000 total handler calls | Passed locally |
| Foundry lint | `forge lint` | No warning-or-higher findings; informational style notes remain |
| Keeper syntax and policy | `npm --prefix keeper run check && npm --prefix keeper test` | 4/4 policy tests passed; gas-only, permissionless fallback remains available |
| Keeper dependency install | Viem 2.55.10; npm reported zero vulnerabilities during install | Passed locally |
| Indexer reconstruction | `npm --prefix indexer test` | 5/5 replay, duplicate, reorg, confirmed-read solvency, and freshness tests passed |
| Static analysis | Slither 0.11.5 plus `forge lint --severity high` | 11 Slither results dispositioned in `STATIC_ANALYSIS.md`; two Slither IR-generation limitations remain explicit |
| Mainnet fork | `MAINNET_RPC_URL=… forge test --match-path test/V4StrategyHookFork.t.sol --force -vv` | 17/17 passed against official PoolManager; pinned block 25,664,100 plus a separate current-head smoke check |
| Runtime source binding | Official feed + Blast archive RPC + Blockscout verified source | PoolManager runtime hash matched; 43/43 published source files matched Uniswap v4.0.0 commit `e50237c…` |
| Gas snapshot | `forge snapshot --offline --match-contract V4StrategyHookTest` | Strategy lifecycle test: 603,475 gas; below the declared 1,000,000 keeper ceiling |
| Deterministic preflight | Programmable Builder 1.3.0 report | `PROTOTYPE_READY`; high-risk candidate gates remain open |

All evidence is local and must be rebound to an exact clean public Git commit before submission.

## Explicitly absent

- No independent audit, security review, or specialist acceptance of the local Slither dispositions
- No deployment transaction or V4 Strategy Hook runtime (the PoolManager dependency is runtime/source bound)
- No live lifecycle receipts
- No monitoring deployment or incident drill
- No Hooklist, Uniswap routing or interface support
- No Programmable maintainer acceptance or product integration
- No public availability claim

The live V4STR worker and its prior transactions demonstrate product demand only. They do not evidence this hook's
accounting, deployment or behavior.
