# V4 Strategy Hook specification

Version: `0.1.0-prototype`

## Boundary

One hook instance serves exactly one canonical pool. Native ETH is `currency0`; a standard fixed-supply launch token is
`currency1`. A separate, already initialized native-ETH/target-token v4 pool supplies buyback execution and sampled
price observations. Alternative pools exist outside the reviewed behavior and cannot enter the instance's namespace.

## Immutable configuration

`StrategyConfig` binds creator, launched token, target token, independent buy and sell selected totals, strategy share,
canonical and target PoolKeys, execution threshold, cooldown, oracle window and cadence, maximum slippage, maximum TWAP
deviation, and maximum price impact. The constructor rejects zero critical addresses, a target hook equal to itself,
fees over 10%, strategy shares over 100%, nonpositive tick spacing, empty safety windows, and an uninitialized target
pool.

The following cannot be configured: the 10 bps Programmable fee, immutable Programmable owner, burn recipient, hook
permission mask, native quote asset, liability currency, or permissionless executor policy.

## Canonical-pool fees

For each direction, `effective = max(selected, 10 bps)` and `project = effective - 10 bps`.

For gross native quote amount `G`:

```text
total        = floor(G × effective / 10,000)
programmable = min(total, floor(G × 10 / 10,000))
project      = total - programmable
strategy     = floor(project × strategyShare / 10,000)
creator      = project - strategy
```

For a net exact-output native amount, gross is rounded up before the same partition. The creator receives the remainder,
so each partition sums exactly to the total fee.

When native ETH is the specified currency, `beforeSwap` charges it and `afterSwap` proves that the PoolManager leg was
not partially filled. When native ETH is unspecified, `afterSwap` charges the actual executed amount. A partial fill on
a specified-native path reverts; therefore every successful specified-native swap has an executed basis equal to its
verified full amount.

Each charge mints native ERC-6909 claims to the hook and increments three liabilities. At all times:

```text
programmableFeesAccrued + creatorFeesAccrued + strategyFeesAccrued
  = totalNativeLiabilities
  <= PoolManager.balanceOf(hook, nativeCurrencyId)
```

## Claims

The immutable creator can redeem only `creatorFeesAccrued`, to itself. The immutable Programmable owner
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` can redeem only `programmableFeesAccrued`, to an address it selects for
that call. Accounting is decremented before PoolManager unlock; any redemption failure reverts the transaction.

There is no strategy claim or withdrawal. Strategy value can leave only through `executeStrategy()`.

## Oracle

The hook stores 16 observations containing timestamp, target-pool tick, and cumulative tick. Observations are accepted
only after the minimum spacing. A gap over the immutable maximum resets history; execution remains unavailable until a
full window exists again. The current spot tick must remain within the configured maximum deviation from the sampled
TWAP.

The sampled oracle assumes at least one observation per configured maximum gap. It is not equivalent to a continuously
written oracle and requires economic review against the selected target pool's liquidity and likely transaction value.

## Strategy execution

`executeStrategy()` is permissionless and processes all current strategy liability if threshold, cooldown, oracle,
deviation, output and impact checks pass. Effects occur before PoolManager unlock. The hook then:

1. swaps exact native input through the immutable target PoolKey;
2. burns the matching native ERC-6909 claim to settle the input delta;
3. takes the exact target-token credit to itself;
4. verifies output against its TWAP-derived floor;
5. transfers the exact output to the fixed dead address;
6. verifies no purchased target token remains and the dead-address balance increased by exactly that output.

Any failure reverts every step. Direct token donations are not liabilities and are deliberately unrecoverable because
the hook has no sweep.

## Permissions

Mask `0x20cc`:

- `beforeInitialize`
- `beforeSwap`
- `afterSwap`
- `beforeSwapReturnDelta`
- `afterSwapReturnDelta`

All other permission bits are false. The hook authenticates the immutable PoolManager through `BaseHook`; callback
`sender` is recorded only as the swap caller/router and is never treated as an end-user identity. `hookData` is ignored.
