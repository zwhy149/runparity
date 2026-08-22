/**
 * Frozen-oracle evaluation for one arm outcome.
 *
 * The oracle is fixed before A1 ever runs and is evaluated identically for
 * every arm. A bare exit zero is never sufficient on its own: the declared
 * stream assertion must also hold. This module makes no family diagnosis and
 * emits no verdict — the proof-ledger verifier consumes its results.
 */

export type FrozenOracleV1 = Readonly<{
  type: "exit_code_and_stdout";
  exit_code: number;
  stdout_contains: string;
}>;

export type OracleEvaluation = Readonly<{
  oracle_type: "exit_code_and_stdout";
  satisfied: boolean;
  checks: Readonly<{
    exit_code_matches: boolean;
    stdout_contains_matches: boolean;
  }>;
  observed: Readonly<{
    exit_code: number | null;
    stdout_excerpt: readonly string[];
  }>;
}>;

const MAX_OBSERVED_LINES = 16;
const MAX_EXCERPT_LINE_BYTES = 256;

function boundedLines(text: string): readonly string[] {
  const lines = text
    .split("\n")
    .map((line) =>
      line.length > MAX_EXCERPT_LINE_BYTES ? line.slice(0, MAX_EXCERPT_LINE_BYTES) : line,
    )
    .slice(0, MAX_OBSERVED_LINES);
  return Object.freeze(lines);
}

export function evaluateFrozenOracle(
  oracle: FrozenOracleV1,
  outcome: Readonly<{ exitCode: number | null; stdout: string }>,
): OracleEvaluation {
  if (!Number.isSafeInteger(oracle.exit_code) || oracle.exit_code < 0) {
    throw new Error("RP_ORACLE_INVALID_EXIT_CODE");
  }
  if (oracle.stdout_contains.length === 0 || oracle.stdout_contains.length > 128) {
    throw new Error("RP_ORACLE_INVALID_STDOUT_ASSERTION");
  }
  const exitMatches = outcome.exitCode === oracle.exit_code;
  const stdoutLines = boundedLines(outcome.stdout);
  const contains = stdoutLines.some((line) => line.includes(oracle.stdout_contains));
  return Object.freeze({
    oracle_type: "exit_code_and_stdout",
    satisfied: exitMatches && contains,
    checks: Object.freeze({
      exit_code_matches: exitMatches,
      stdout_contains_matches: contains,
    }),
    observed: Object.freeze({
      exit_code: outcome.exitCode,
      stdout_excerpt: stdoutLines,
    }),
  });
}
