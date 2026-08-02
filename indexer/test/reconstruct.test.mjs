import assert from "node:assert/strict";
import test from "node:test";

import { freshness, reconcile, replay, rollbackToCanonical } from "../src/reconstruct.mjs";

const log = (blockNumber, transactionIndex, logIndex, blockHash, event, args) => ({
  blockNumber,
  transactionIndex,
  logIndex,
  blockHash,
  event,
  args
});

test("replays accrual, independent claims and strategy burns in canonical cursor order", () => {
  const state = replay([
    log(11, 0, 0, "0xbbb", "StrategyExecuted", { nativeAmountIn: 9n, targetAmountBurned: 1_000n }),
    log(10, 0, 0, "0xaaa", "NativeFeesAccrued", {
      programmableFee: 10n,
      creatorFee: 81n,
      strategyFee: 9n
    }),
    log(12, 0, 0, "0xccc", "ProgrammableFeesClaimed", { amount: 4n }),
    log(12, 0, 1, "0xccc", "CreatorFeesClaimed", { amount: 1n })
  ]);

  assert.deepEqual(state.lastCursor, [12, 0, 1]);
  assert.equal(state.programmable, 6n);
  assert.equal(state.creator, 80n);
  assert.equal(state.strategy, 0n);
  assert.equal(state.totalLiabilities, 86n);
  assert.equal(state.totalNativeExecuted, 9n);
  assert.equal(state.totalTargetBurned, 1_000n);
});

test("rejects duplicate cursors and event sequences that overdraw a liability", () => {
  const duplicate = log(10, 0, 0, "0xaaa", "NativeFeesAccrued", {
    programmableFee: 1n,
    creatorFee: 0n,
    strategyFee: 0n
  });
  assert.throws(() => replay([duplicate, duplicate]), /duplicate/);
  assert.throws(
    () => replay([log(10, 0, 0, "0xaaa", "CreatorFeesClaimed", { amount: 1n })]),
    /negative liability/
  );
});

test("rolls orphaned logs back and deterministically replays the canonical branch", () => {
  const logs = [
    log(10, 0, 0, "0xaaa", "NativeFeesAccrued", {
      programmableFee: 10n,
      creatorFee: 81n,
      strategyFee: 9n
    }),
    log(11, 0, 0, "0xorphan", "StrategyExecuted", { nativeAmountIn: 9n, targetAmountBurned: 500n }),
    log(11, 0, 0, "0xcanonical", "StrategyExecuted", { nativeAmountIn: 9n, targetAmountBurned: 1_000n })
  ];
  const canonical = new Map([
    [10, "0xaaa"],
    [11, "0xcanonical"]
  ]);
  const state = replay(rollbackToCanonical(logs, canonical));
  assert.equal(state.strategy, 0n);
  assert.equal(state.totalTargetBurned, 1_000n);
  assert.equal(state.lastBlockHash, "0xcanonical");
});

test("quarantines mismatched or insolvent confirmed reads", () => {
  const state = replay([
    log(10, 0, 0, "0xaaa", "NativeFeesAccrued", {
      programmableFee: 10n,
      creatorFee: 81n,
      strategyFee: 9n
    })
  ]);
  assert.deepEqual(
    reconcile(state, {
      programmable: 10n,
      creator: 81n,
      strategy: 9n,
      totalLiabilities: 100n,
      poolManagerClaims: 100n
    }),
    { liabilitiesMatch: true, solvent: true, publishable: true }
  );
  assert.equal(
    reconcile(state, {
      programmable: 10n,
      creator: 81n,
      strategy: 9n,
      totalLiabilities: 100n,
      poolManagerClaims: 99n
    }).publishable,
    false
  );
});

test("reports finalized lag without accepting future timestamps", () => {
  assert.deepEqual(freshness(1_000, 980, 30, 120), { lagSeconds: 20, fresh: true, stale: false });
  assert.deepEqual(freshness(1_000, 800, 30, 120), { lagSeconds: 200, fresh: false, stale: true });
  assert.throws(() => freshness(1_000, 1_001, 30, 120), /ahead/);
});
