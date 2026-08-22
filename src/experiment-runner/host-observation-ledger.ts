import { sha256Hex } from "../backend/digest.js";
import { buildPathShadowingSignature, signatureSha256 } from "./failure-signature.js";
import type { FrozenOracleV1 } from "./oracle-evaluator.js";

/**
 * Host-observation verification ledger for challenge cases.
 *
 * Challenge cases (out-of-scope platform environments, hard negatives) can
 * never receive an A1/B/A2 proof ledger: their claim is exactly that no
 * isolated intervention exists for their platform. Their verification is a
 * pre-registered number of stable native-platform Host Observe runs — here
 * three — each carrying the observed verdict, the bounded redacted target
 * streams, and a recomputable failure signature. Stability means the three
 * signatures are identical; the verdict must equal the manifest's expected
 * non-actionable terminal verdict with no intervention anywhere.
 */

export type HostObservationRun = Readonly<{
  index: number;
  doctor_exit_code: number;
  target_exit_code: number | null;
  verdict: string;
  reason_codes: readonly string[];
  stdout_lines: readonly string[];
  stderr_lines: readonly string[];
  signature: ReturnType<typeof buildPathShadowingSignature> | null;
  signature_sha256: string | null;
}>;

export type HostObservationLedgerV1 = Readonly<{
  schema_version: "runparity.fixture-verification-ledger/v1";
  ledger_kind: "host_observation";
  case_id: string;
  repetitions: 3;
  manifest_sha256: string;
  build_receipt_sha256: string;
  backend_qualification_sha256: null;
  expected_terminal_verdict: string;
  observations: readonly HostObservationRun[];
  stability: Readonly<{
    all_signatures_present: boolean;
    distinct_signature_count: number;
    verdict_matches_expected: boolean;
  }>;
  runner_version: string;
  verified_at: string;
  status: "passed" | "failed";
}>;

const MAX_LINES = 16;
const MAX_LINE_BYTES = 256;

export function boundedObservationLines(text: string): readonly string[] {
  return Object.freeze(
    text
      .split("\n")
      .map((line) => (line.length > MAX_LINE_BYTES ? line.slice(0, MAX_LINE_BYTES) : line))
      .slice(0, MAX_LINES),
  );
}

export function hostObservationRunFromCapture(
  input: Readonly<{
    index: number;
    doctorExitCode: number;
    targetExitCode: number | null;
    verdict: string;
    reasonCodes: readonly string[];
    stdoutExcerpt: string;
    stderrExcerpt: string;
  }>,
): HostObservationRun {
  const stdoutLines = boundedObservationLines(input.stdoutExcerpt);
  const stderrLines = boundedObservationLines(input.stderrExcerpt);
  const signature = buildPathShadowingSignature({
    exit_code: input.targetExitCode,
    stdout_lines: stdoutLines,
    stderr_lines: stderrLines,
  });
  return Object.freeze({
    index: input.index,
    doctor_exit_code: input.doctorExitCode,
    target_exit_code: input.targetExitCode,
    verdict: input.verdict,
    reason_codes: Object.freeze([...input.reasonCodes]),
    stdout_lines: stdoutLines,
    stderr_lines: stderrLines,
    signature,
    signature_sha256: signatureSha256(signature),
  });
}

export function buildHostObservationLedger(
  input: Readonly<{
    caseId: string;
    manifestSha256: string;
    buildReceiptSha256: string;
    expectedTerminalVerdict: string;
    runs: readonly HostObservationRun[];
    runnerVersion: string;
    verifiedAtIso: string;
  }>,
): HostObservationLedgerV1 {
  if (input.runs.length !== 3) {
    throw new Error("RP_HOST_LEDGER_INVALID_RUN_COUNT");
  }
  const distinct = new Set(
    input.runs.map((run) => (run.signature === null ? "null" : JSON.stringify(run.signature))),
  );
  const verdictMatches = input.runs.every((run) => run.verdict === input.expectedTerminalVerdict);
  const allPresent = input.runs.every((run) => run.signature !== null);
  const stable = allPresent && distinct.size === 1 && verdictMatches;
  return Object.freeze({
    schema_version: "runparity.fixture-verification-ledger/v1",
    ledger_kind: "host_observation",
    case_id: input.caseId,
    repetitions: 3,
    manifest_sha256: input.manifestSha256,
    build_receipt_sha256: input.buildReceiptSha256,
    backend_qualification_sha256: null,
    expected_terminal_verdict: input.expectedTerminalVerdict,
    observations: Object.freeze([...input.runs]),
    stability: Object.freeze({
      all_signatures_present: allPresent,
      distinct_signature_count: distinct.size,
      verdict_matches_expected: verdictMatches,
    }),
    runner_version: input.runnerVersion,
    verified_at: input.verifiedAtIso,
    status: stable ? "passed" : "failed",
  });
}

export function hostObservationLedgerSha256(ledger: HostObservationLedgerV1): string {
  return sha256Hex(JSON.stringify(ledger));
}

export type HostObservationVerdict =
  | Readonly<{ verdict: "verified_host_observation"; blocking: readonly string[] }>
  | Readonly<{ verdict: "unstable_or_mismatched"; blocking: readonly string[] }>;

export function verifyHostObservationLedger(ledger: {
  ledger_kind?: unknown;
  observations?: unknown;
  [key: string]: unknown;
}): HostObservationVerdict {
  const blocking: string[] = [];
  if (ledger.ledger_kind !== "host_observation") {
    return { verdict: "unstable_or_mismatched", blocking: ["ledger_kind_not_host_observation"] };
  }
  const runs = Array.isArray(ledger.observations) ? ledger.observations : [];
  if (runs.length !== 3) {
    blocking.push(`expected 3 observations, found ${runs.length}`);
  }
  const distinct = new Set<string>();
  for (const run of runs) {
    if (run === null || typeof run !== "object") {
      blocking.push("observation malformed");
      continue;
    }
    const record = run as Record<string, unknown>;
    if (record["signature"] === null || record["signature"] === undefined) {
      blocking.push(`observation_${String(record["index"])}_signature_missing`);
      continue;
    }
    const recomputed = buildPathShadowingSignature({
      exit_code: record["target_exit_code"] as number | null,
      stdout_lines: Array.isArray(record["stdout_lines"])
        ? (record["stdout_lines"] as string[])
        : [],
      stderr_lines: Array.isArray(record["stderr_lines"])
        ? (record["stderr_lines"] as string[])
        : [],
    });
    const recomputedJson = JSON.stringify(recomputed);
    const embeddedJson = JSON.stringify(record["signature"]);
    if (recomputedJson !== embeddedJson) {
      blocking.push(`observation_${String(record["index"])}_signature_mismatch`);
    }
    if (signatureSha256(recomputed) !== record["signature_sha256"]) {
      blocking.push(`observation_${String(record["index"])}_signature_digest_mismatch`);
    }
    distinct.add(recomputedJson);
    if (record["verdict"] !== ledger["expected_terminal_verdict"]) {
      blocking.push(`observation_${String(record["index"])}_verdict_mismatch`);
    }
  }
  if (distinct.size !== 1) {
    blocking.push(`signature_unstable:${distinct.size}`);
  }
  if (ledger["status"] !== "passed") {
    blocking.push("ledger_status_not_passed");
  }
  return {
    verdict: blocking.length === 0 ? "verified_host_observation" : "unstable_or_mismatched",
    blocking: Object.freeze(blocking),
  };
}

export type { FrozenOracleV1 };
