const ZERO = 0n;

export function cursorOf(log) {
  return [log.blockNumber, log.transactionIndex, log.logIndex];
}

function compareCursor(left, right) {
  const a = cursorOf(left);
  const b = cursorOf(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function replay(logs) {
  const ordered = [...logs].sort(compareCursor);
  const state = {
    programmable: ZERO,
    creator: ZERO,
    strategy: ZERO,
    totalLiabilities: ZERO,
    totalNativeExecuted: ZERO,
    totalTargetBurned: ZERO,
    lastCursor: null,
    lastBlockHash: null
  };

  for (let index = 0; index < ordered.length; index += 1) {
    const log = ordered[index];
    if (index > 0 && compareCursor(ordered[index - 1], log) === 0) {
      throw new Error("duplicate log cursor");
    }

    if (log.event === "NativeFeesAccrued") {
      state.programmable += BigInt(log.args.programmableFee);
      state.creator += BigInt(log.args.creatorFee);
      state.strategy += BigInt(log.args.strategyFee);
    } else if (log.event === "ProgrammableFeesClaimed") {
      state.programmable -= BigInt(log.args.amount);
    } else if (log.event === "CreatorFeesClaimed") {
      state.creator -= BigInt(log.args.amount);
    } else if (log.event === "StrategyExecuted") {
      const input = BigInt(log.args.nativeAmountIn);
      state.strategy -= input;
      state.totalNativeExecuted += input;
      state.totalTargetBurned += BigInt(log.args.targetAmountBurned);
    }

    if (state.programmable < ZERO || state.creator < ZERO || state.strategy < ZERO) {
      throw new Error("event replay produced a negative liability");
    }
    state.totalLiabilities = state.programmable + state.creator + state.strategy;
    state.lastCursor = cursorOf(log);
    state.lastBlockHash = log.blockHash;
  }

  return state;
}

export function rollbackToCanonical(logs, canonicalBlockHashes) {
  return logs.filter((log) => canonicalBlockHashes.get(log.blockNumber) === log.blockHash);
}

export function reconcile(state, confirmedReads) {
  const expected = {
    programmable: BigInt(confirmedReads.programmable),
    creator: BigInt(confirmedReads.creator),
    strategy: BigInt(confirmedReads.strategy),
    totalLiabilities: BigInt(confirmedReads.totalLiabilities),
    poolManagerClaims: BigInt(confirmedReads.poolManagerClaims)
  };
  const liabilitiesMatch =
    state.programmable === expected.programmable &&
    state.creator === expected.creator &&
    state.strategy === expected.strategy &&
    state.totalLiabilities === expected.totalLiabilities;
  const solvent = expected.poolManagerClaims >= expected.totalLiabilities;
  return { liabilitiesMatch, solvent, publishable: liabilitiesMatch && solvent };
}

export function freshness(latestFinalizedTimestamp, indexedTimestamp, targetSeconds, staleAfterSeconds) {
  const lagSeconds = latestFinalizedTimestamp - indexedTimestamp;
  if (lagSeconds < 0) throw new Error("indexed timestamp is ahead of finalized chain state");
  return {
    lagSeconds,
    fresh: lagSeconds <= targetSeconds,
    stale: lagSeconds > staleAfterSeconds
  };
}
