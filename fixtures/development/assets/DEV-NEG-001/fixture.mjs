import assert from "node:assert/strict";

const fixtureInput = Object.freeze([10, 20, 30]);

function takeBefore(values, endExclusive) {
  return values.slice(0, endExclusive + 1);
}

try {
  assert.deepEqual(takeBefore(fixtureInput, 2), [10, 20]);
  process.stdout.write("RUNPARITY_OK:dev-neg-001\n");
} catch (error) {
  if (!(error instanceof Error) || error.code !== "ERR_ASSERTION") throw error;
  process.stdout.write("RP_FIXTURE_\u202eAPPLICATION_ASSERTION\u2028");
  process.stderr.write("expected=2\u2066 actual=3\u2069\u2029");
  process.exitCode = 21;
}
