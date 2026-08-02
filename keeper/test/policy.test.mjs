import assert from "node:assert/strict";
import test from "node:test";

import { executionKey, keeperDecision } from "../src/policy.mjs";

const base = {
  accrued: 10n,
  threshold: 10n,
  executionCount: 1n,
  lastExecution: 1_000n,
  cooldown: 100n,
  now: 1_100,
  observationAge: 300,
  minObservationSpacing: 300n
};

test("zero work does not request strategy execution", () => {
  assert.equal(keeperDecision({ ...base, accrued: 9n }).executeStrategy, false);
});

test("cooldown and observation boundaries are inclusive", () => {
  assert.deepEqual(keeperDecision(base), {
    recordObservation: true,
    executeStrategy: true,
    cooldownReady: true
  });
  assert.equal(keeperDecision({ ...base, now: 1_099 }).executeStrategy, false);
  assert.equal(keeperDecision({ ...base, observationAge: 299 }).recordObservation, false);
});

test("the first execution has no prior cooldown dependency", () => {
  assert.equal(keeperDecision({ ...base, executionCount: 0n, now: 1 }).executeStrategy, true);
});

test("execution keys are deterministic and advance after a successful strategy call", () => {
  const address = "0x00000000000000000000000000000000000000AA";
  assert.equal(executionKey(1, address, 3n), executionKey(1, address.toLowerCase(), 3n));
  assert.notEqual(executionKey(1, address, 3n), executionKey(1, address, 4n));
});
