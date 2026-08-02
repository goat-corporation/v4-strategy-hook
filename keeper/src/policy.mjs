export function keeperDecision({
  accrued,
  threshold,
  executionCount,
  lastExecution,
  cooldown,
  now,
  observationAge,
  minObservationSpacing
}) {
  const cooldownReady = executionCount === 0n || now >= Number(lastExecution) + Number(cooldown);
  return {
    recordObservation: observationAge >= Number(minObservationSpacing),
    executeStrategy: accrued >= threshold && cooldownReady,
    cooldownReady
  };
}

export function executionKey(chainId, hookAddress, executionCount) {
  return `${chainId}:${hookAddress.toLowerCase()}:${executionCount}`;
}
