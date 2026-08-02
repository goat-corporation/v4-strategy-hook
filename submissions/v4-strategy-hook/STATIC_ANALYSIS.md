# Static-analysis dispositions

This is builder-declared prototype evidence, not an audit. Slither 0.11.5 analyzed the model-owned contracts with
dependencies and tests excluded from detector reporting. The complete machine result is
[`evidence/slither.json`](evidence/slither.json): `success=true`, 35 contracts analyzed, 101 detectors enabled, and 11
reported results. No finding was hidden or suppressed.

## Findings

| Slither result | Disposition |
| --- | --- |
| `reentrancy-no-eth` in `executeStrategy` | Reviewed, not exploitable under the declared boundary. `executeStrategy` uses OpenZeppelin `ReentrancyGuardTransient`; strategy liability and the execution timestamp are committed before `PoolManager.unlock`; the three counters written afterward are reporting-only and cannot authorize or redirect value. Any callback or token failure reverts the whole transaction. |
| two `uninitialized-local` results in `_consultTwap` | Solidity initializes the local boolean to `false` and the memory struct to zero. `anchor` is read only after `found` is true; otherwise `OracleNotReady` reverts. The oracle lifecycle and gap reset are exercised in unit and lifecycle tests. |
| three `unused-return` results for `getSlot0` | Intentional tuple destructuring. The constructor needs initialized price and tick; observation and execution need tick. The unused protocol-fee and LP-fee tuple members are not security inputs for this hook. |
| `reentrancy-benign` in `executeStrategy` | Same guarded call site as above. Post-call writes are cumulative telemetry only; the exact output and burn balance are checked first. |
| `reentrancy-events` in `_chargeNative` | `NATIVE.take` targets the immutable PoolManager during an authenticated PoolManager callback, not an arbitrary receiver. Accounting is updated before the claim mint; failure is atomic. Emitting after successful mint prevents an event from describing reverted state. |
| `timestamp` in `executeStrategy` | Intended use for cooldown and sampled-oracle freshness. Timestamp drift cannot select the route, target, recipient, amount, `minOut`, or price limit; unsafe timing fails closed. |
| two `too-many-digits` results in the factory | Slither attached this informational detector to `keccak256(abi.encodePacked(...))`; no decimal literal exists at either site. The exact init-code hash, CREATE2 preimage, permission mask, and deployed address are tested. |

## Analyzer limitations

Slither reported that it could not generate IR for `unlockCallback` and `_absolute` because of an internal
`NoneType.parameters` error. This is recorded as a tooling limitation, not treated as proof those functions are safe.
Their reachable paths are covered by authenticated-callback tests, exact claim redemption, exact strategy settlement,
fuzzing, stateful solvency invariants, and the pinned-mainnet lifecycle suite. Independent specialist review remains a
candidate gate.

## Compiler known-bug review

The exact compiler is Solidity `0.8.26+commit.8a97fa7a`, Cancun EVM, optimizer enabled for 200 runs, `viaIR=false`,
metadata bytecode hash disabled, CBOR metadata disabled, and FFI disabled. The official `bugs.json` at compiler source
commit `8a97fa7a1db1ec509221ead6fea6802c684ee887` has SHA-256
`8bd474fc163b9a50d45b831390cd861aa61c47468c3153777c5cfb9d8518a8f0`; no listed bug is introduced at or before
0.8.26 and fixed after 0.8.26 (or still unfixed).

## Exact commands

```bash
slither . --exclude-dependencies --filter-paths 'lib|test' \
  --json submissions/v4-strategy-hook/evidence/slither.json
forge lint --severity high
```
