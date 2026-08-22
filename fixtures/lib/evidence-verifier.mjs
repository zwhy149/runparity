// RunParity independent evidence verifier (fixture validator side).
//
// Protocol amendment (documented in docs/adr/0005 and docs/VALIDATION.md):
// the fixture validator no longer refuses every backend/ledger receipt on
// principle. It now re-derives each claim independently:
//
//   * the backend qualification receipt must carry controls that are ALL
//     demonstrated and must bind its facts sidecar by the canonical-JSON
//     SHA-256 of the collected facts;
//   * the verification ledger must satisfy the full A1/B/A2 proof rules —
//     signatures, oracle, single-intervention diff, A1≡A2, safety —
//     recomputed here from the embedded bounded observations, NOT trusted
//     from the runner;
//   * the ledger binds the manifest by its EVIDENCE PROJECTION digest: the
//     canonical JSON of the manifest with only the promotion fields removed
//     (fixture_status, verified_at, backend_qualification slot,
//     verification_ledger slot). Promotion therefore changes status fields
//     without invalidating the evidence the ledger points at; any change to
//     scenario, oracle, intervention, platform, or safety expectations DOES
//     invalidate it.
//
// This module deliberately shares no code with src/ so a defect in the
// runner's verifier cannot silently mask itself here.

import { createHash } from "node:crypto";

const _PROMOTION_FIELDS = {
  fixture_status: true,
  "implementation.verified_at": true,
  "implementation.receipts.backend_qualification": true,
  "implementation.receipts.verification_ledger": true,
};

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("non-JSON value in evidence projection");
  }
  return serialized;
}

export function manifestEvidenceProjection(manifest) {
  const clone = structuredClone(manifest);
  delete clone["fixture_status"];
  const implementation = clone["implementation"];
  if (implementation !== null && typeof implementation === "object") {
    delete implementation["verified_at"];
    const receipts = implementation["receipts"];
    if (receipts !== null && typeof receipts === "object") {
      delete receipts["backend_qualification"];
      delete receipts["verification_ledger"];
    }
  }
  return clone;
}

export function manifestEvidenceSha256(manifest) {
  return createHash("sha256")
    .update(canonicalJson(manifestEvidenceProjection(manifest)), "utf8")
    .digest("hex");
}

function pathSignature(observation) {
  const lines = Array.isArray(observation.stdout_lines) ? observation.stdout_lines : [];
  const errLines = Array.isArray(observation.stderr_lines) ? observation.stderr_lines : [];
  const classify = (source, prefix) => {
    const sentinels = [];
    for (const line of source) {
      if (typeof line !== "string") continue;
      const trimmed = line.trim();
      if (trimmed.startsWith(prefix) && !sentinels.includes(trimmed.slice(0, 128))) {
        sentinels.push(trimmed.slice(0, 128));
      }
    }
    return sentinels.sort();
  };
  return canonicalJson({
    schema_version: "runparity.failure-signature/path-shadowing/v1",
    family: "PATH_SHADOWING",
    exit_code: observation.exit_code,
    stdout_sentinels: classify(lines, "RUNPARITY_OK:"),
    stderr_sentinels: classify(errLines, "RP_FIXTURE_"),
  });
}

function pathEnvToken(argv) {
  let expectingValue = false;
  for (const token of argv) {
    if (token === "-e") {
      expectingValue = true;
      continue;
    }
    if (expectingValue) {
      if (typeof token === "string" && token.startsWith("PATH=")) return token;
      expectingValue = false;
    }
  }
  return null;
}

function argvDifferOnlyAtPath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  let differences = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) differences += 1;
  }
  return differences === 1;
}

/**
 * Verify a backend qualification receipt against its facts sidecar.
 * Returns { ok, problems }.
 */
export function verifyBackendQualificationReceipt({ receipt, facts }) {
  const problems = [];
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.schema_version !== "runparity.backend-qualification-receipt/v1"
  ) {
    return { ok: false, problems: ["receipt is not a backend qualification receipt v1"] };
  }
  if (receipt.status !== "qualified") problems.push("receipt status is not qualified");
  if (receipt.backend !== "linux_rootless_oci") problems.push("backend is not linux_rootless_oci");
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(receipt.image_digest ?? ""))) {
    problems.push("image_digest is not a sha256 digest");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(receipt.policy_digest ?? ""))) {
    problems.push("policy_digest is not a sha256 digest");
  }
  const controls = Array.isArray(receipt.controls) ? receipt.controls : [];
  if (controls.length === 0) problems.push("receipt carries no control judgments");
  for (const control of controls) {
    if (control?.status !== "demonstrated") {
      problems.push(`control ${control?.id ?? "?"} is ${control?.status ?? "absent"}`);
    }
  }
  if (typeof receipt.facts_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.facts_sha256)) {
    problems.push("facts_sha256 missing");
  } else if (facts === null || typeof facts !== "object") {
    problems.push("facts sidecar missing");
  } else {
    let factsDigest = null;
    try {
      factsDigest = createHash("sha256")
        .update(canonicalJson(structuredClone(facts)), "utf8")
        .digest("hex");
    } catch {
      problems.push("facts sidecar is not canonicalizable JSON");
    }
    if (factsDigest !== null && factsDigest !== receipt.facts_sha256) {
      problems.push("facts sidecar digest does not match receipt.facts_sha256");
    }
    const factsImageRef = facts?.image_digest_ref;
    if (typeof factsImageRef === "string" && factsImageRef !== receipt.image_digest_ref) {
      problems.push("facts image reference differs from receipt");
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Independently re-derive the A1/B/A2 proof from a verification ledger.
 * `links` carries { manifestEvidenceSha256, buildReceiptSha256, backendReceiptSha256 }.
 * Returns { ok, problems }.
 */
export function verifyVerificationLedger({ ledger, links, item }) {
  const problems = [];
  if (
    ledger === null ||
    typeof ledger !== "object" ||
    ledger.schema_version !== "runparity.fixture-verification-ledger/v1"
  ) {
    return { ok: false, problems: ["ledger is not a fixture verification ledger v1"] };
  }
  if (ledger.ledger_kind !== "a1_b_a2") problems.push("ledger_kind is not a1_b_a2");
  if (ledger.case_id !== item.case_id) problems.push("case_id mismatch");
  if (ledger.repetitions !== 3) problems.push("repetitions is not 3");
  if (ledger.status !== "passed") problems.push("status is not passed");
  if (ledger.intervention?.type !== item.allowed_typed_intervention?.type) {
    problems.push("intervention type does not match the manifest");
  }
  if (ledger.manifest_sha256 !== links.manifestEvidenceSha256) {
    problems.push("manifest evidence-projection digest mismatch (see protocol amendment)");
  }
  if (ledger.build_receipt_sha256 !== links.buildReceiptSha256) {
    problems.push("build_receipt_sha256 mismatch");
  }
  if (ledger.backend_qualification_sha256 !== links.backendReceiptSha256) {
    problems.push("backend_qualification_sha256 mismatch");
  }
  if (ledger.oracle_frozen?.type !== "exit_code_and_stdout") {
    problems.push("oracle_frozen type unsupported");
  }
  if (
    !Number.isInteger(ledger.oracle_frozen?.exit_code) ||
    typeof ledger.oracle_frozen?.stdout_contains !== "string" ||
    ledger.oracle_frozen.stdout_contains.length === 0
  ) {
    problems.push("oracle_frozen is incomplete");
  }
  if (
    ledger.oracle_frozen?.exit_code !== item.oracle?.success?.exit_code ||
    ledger.oracle_frozen?.stdout_contains !== item.oracle?.success?.stdout_contains
  ) {
    problems.push("oracle_frozen does not match the manifest oracle");
  }
  if (ledger.safety?.all_arms_completed !== true) problems.push("safety: arms incomplete");
  if (ledger.safety?.all_containers_removed !== true) problems.push("safety: containers left over");
  if (ledger.safety?.all_home_dirs_fresh !== true) problems.push("safety: stale arm homes");

  const sequences = Array.isArray(ledger.sequences) ? ledger.sequences : [];
  if (sequences.length !== 3) {
    problems.push(`expected 3 sequences, found ${sequences.length}`);
  }
  const signatureSet = new Set();
  for (const sequence of sequences) {
    const index = sequence?.index ?? "?";
    const arms = Array.isArray(sequence?.arms) ? sequence.arms : [];
    if (arms.length !== 3) {
      problems.push(`sequence ${index}: expected 3 arms`);
      continue;
    }
    const [a1, b, a2] = arms;
    if (a1?.identity !== "A1" || b?.identity !== "B" || a2?.identity !== "A2") {
      problems.push(`sequence ${index}: arm order mismatch`);
      continue;
    }
    for (const arm of arms) {
      if (arm.outcome !== "completed" || arm.exit_code === null) {
        problems.push(`sequence ${index} ${arm.identity}: not completed`);
      }
      if (arm.post_run_container_absent !== true) {
        problems.push(`sequence ${index} ${arm.identity}: container leftover`);
      }
      if (arm.home_dir_created_fresh !== true) {
        problems.push(`sequence ${index} ${arm.identity}: stale home`);
      }
    }
    for (const arm of [a1, a2]) {
      const recomputed = pathSignature(arm);
      signatureSet.add(recomputed);
      if (arm.signature === null || canonicalJson(arm.signature) !== recomputed) {
        problems.push(`sequence ${index} ${arm.identity}: embedded signature mismatch`);
      }
      if (arm.signature_sha256 !== createHash("sha256").update(recomputed, "utf8").digest("hex")) {
        problems.push(`sequence ${index} ${arm.identity}: signature digest mismatch`);
      }
      if (arm.exit_code === 0) {
        problems.push(`sequence ${index} ${arm.identity}: A arm unexpectedly succeeded`);
      }
      const parsedSignature = (() => {
        try {
          return JSON.parse(recomputed);
        } catch {
          return null;
        }
      })();
      if (
        parsedSignature === null ||
        (parsedSignature.stdout_sentinels?.length ?? 0) +
          (parsedSignature.stderr_sentinels?.length ?? 0) ===
          0
      ) {
        problems.push(`sequence ${index} ${arm.identity}: no failure sentinel observed`);
      }
    }
    const bOracleChecks = {
      exit: b.exit_code === ledger.oracle_frozen?.exit_code,
      stdout:
        Array.isArray(b.stdout_lines) &&
        b.stdout_lines.some(
          (line) =>
            typeof line === "string" &&
            line.includes(ledger.oracle_frozen?.stdout_contains ?? "\u0000"),
        ),
    };
    if (!(bOracleChecks.exit && bOracleChecks.stdout) || b.oracle_evaluation?.satisfied !== true) {
      problems.push(`sequence ${index} B: frozen oracle not satisfied`);
    }
    const a1Path = pathEnvToken(a1.normalized_argv ?? []);
    const bPath = pathEnvToken(b.normalized_argv ?? []);
    const a2Argv = a2.normalized_argv ?? [];
    const a1Argv = a1.normalized_argv ?? [];
    const argvEqual =
      a1Argv.length === a2Argv.length && a1Argv.every((token, i) => token === a2Argv[i]);
    if (!argvEqual) problems.push(`sequence ${index}: A1/A2 normalized argv diverge`);
    const expectedB =
      a1Path !== null && bPath !== null
        ? `PATH=${ledger.intervention?.directory}:${a1Path.slice("PATH=".length)}`
        : null;
    const singleDelta =
      expectedB !== null &&
      bPath === expectedB &&
      argvDifferOnlyAtPath(a1Argv, b.normalized_argv ?? []);
    if (!singleDelta) problems.push(`sequence ${index}: B is not exactly one path.prepend delta`);
  }
  if (signatureSet.size !== 1) {
    problems.push(
      `failure signature unstable across arms: ${signatureSet.size} distinct signatures`,
    );
  }
  return { ok: problems.length === 0, problems };
}
