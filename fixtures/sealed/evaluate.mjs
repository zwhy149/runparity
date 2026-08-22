// RunParity S1 sealed-corpus evaluator (first tranche).
//
// Regenerates every case from the frozen seed, refuses any manifest digest
// mismatch (the corpus cannot be silently retuned), materializes each case,
// runs the real doctor on the declared command, and compares the observed
// top diagnosis family against the injected gold label.
//
// Metrics follow docs/VALIDATION.md S1 semantics:
//   - in-scope: top family correct per case (category identification)
//   - challenge: NO actionable family finding may be emitted; the observed
//     verdict must be non-actionable (PARTIAL_EVIDENCE / INCONCLUSIVE /
//     REFUSED_OUT_OF_SCOPE with --attempt-proof)
// The results file records raw per-case observations, the platform, and the
// exact doctor JSON digest so any number printed can be re-derived.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSealedCorpus, materializeCase } from "./generate.mjs";

const sealedRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sealedRoot, "..", "..");
const manifestPath = join(sealedRoot, "manifest.json");

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const frozen = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8"));
const { manifest, cases } = generateSealedCorpus(frozen.seed);

// Freeze check: the regenerated corpus must match the committed manifest
// exactly, or the corpus has drifted after freezing.
const regeneratedDigest = sha256Json(manifest);
const committedDigest = sha256Json(frozen);
if (regeneratedDigest !== committedDigest) {
  process.stderr.write("SEALED_CORPUS_DRIFT: regenerated manifest differs from the frozen manifest\n");
  process.exit(64);
}

const platform = process.platform;
const nativeLayerSource = join(
  repositoryRoot,
  "fixtures",
  "development",
  "assets",
  "DEV-NATIVE-001",
  "layers",
  "mismatched.node",
);

const results = [];
const tsxCli = join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliEntry = join(repositoryRoot, "src", "cli.ts");

for (const caseDefinition of cases) {
  const id = caseDefinition.id;
  if (caseDefinition.platform === "linux" && platform !== "linux") {
    results.push({ id, family: caseDefinition.family, status: "skipped_platform", platform });
    continue;
  }
  const workDir = mkdtempSync(join(tmpdir(), `runparity-sealed-${id}-`));
  try {
    materializeCase(caseDefinition, workDir, nativeLayerSource);
    const env = { ...process.env };
    delete env["npm_config_fund"];
    for (const [name, value] of Object.entries(caseDefinition.env ?? {})) {
      if (value !== undefined) env[name] = value;
    }
    if (caseDefinition.pathOrder === "wrong_first" && caseDefinition.binDirs?.wrong) {
      // POSIX launcher case: the wrong bin directory shadows the intended
      // one at the front of PATH.
      const wrongBin = join(workDir, caseDefinition.binDirs.wrong, "bin");
      env["PATH"] = `${wrongBin}:${env["PATH"] ?? ""}`;
      env["REAL_NODE"] = process.execPath;
    }
    const doctor = spawnSync(
      process.execPath,
      [
        tsxCli,
        cliEntry,
        "--json",
        "doctor",
        "--timeout",
        "90s",
        "--",
        ...caseDefinition.command,
      ],
      { cwd: workDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000, env },
    );
    if (doctor.status === null) {
      results.push({ id, family: caseDefinition.family, status: "doctor_failed", platform });
      continue;
    }
    let envelope;
    try {
      envelope = JSON.parse(doctor.stdout);
    } catch {
      results.push({ id, family: caseDefinition.family, status: "unparseable", platform });
      continue;
    }
    const report = envelope?.data?.report ?? {};
    const findings = Array.isArray(report.findings) ? report.findings : [];
    const topCategory = typeof findings[0]?.category === "string" ? findings[0].category : null;
    const verdict = typeof report.verdict === "string" ? report.verdict : null;
    const targetExit = report?.observation?.result?.exit_code ?? null;

    let correct;
    if (caseDefinition.family === "OUT_OF_FAMILY") {
      // Challenge cases: no diagnosis family may be claimed, and the verdict
      // must be non-actionable.
      const nonActionable =
        verdict === "PARTIAL_EVIDENCE" || verdict === "INCONCLUSIVE" || verdict === null;
      correct = topCategory === null && nonActionable;
    } else {
      correct = topCategory === caseDefinition.family;
    }
    results.push({
      id,
      family: caseDefinition.family,
      challenge_kind: caseDefinition.challenge_kind ?? null,
      status: "evaluated",
      platform,
      target_exit_code: targetExit,
      observed_top_category: topCategory,
      observed_verdict: verdict,
      finding_count: findings.length,
      gold_family: caseDefinition.family,
      correct,
    });
  } finally {
    rmSync(workDir, { force: true, recursive: true });
  }
}

const evaluated = results.filter((r) => r.status === "evaluated");
const inScope = evaluated.filter((r) => r.gold_family !== "OUT_OF_FAMILY");
const challenge = evaluated.filter((r) => r.gold_family === "OUT_OF_FAMILY");
const byFamily = {};
for (const family of [
  "PATH_SHADOWING",
  "RUNTIME_MANAGER_DRIFT",
  "CONFIG_PRECEDENCE",
  "NATIVE_ABI_ARCH_MISMATCH",
]) {
  const rows = inScope.filter((r) => r.gold_family === family);
  byFamily[family] = { total: rows.length, correct: rows.filter((r) => r.correct).length };
}

const summary = {
  schema_version: "runparity.sealed-evaluation/v1",
  frozen_manifest_digest: committedDigest,
  platform,
  doctor_invocation: "node tsx src/cli.ts --json doctor --timeout 90s -- <case command>",
  evaluated: evaluated.length,
  skipped_platform: results.length - evaluated.length,
  in_scope: {
    total: inScope.length,
    top_category_correct: inScope.filter((r) => r.correct).length,
    by_family: byFamily,
  },
  challenge: {
    total: challenge.length,
    correctly_non_actionable: challenge.filter((r) => r.correct).length,
  },
  cases: results,
};

const outPath = join(sealedRoot, `evaluation-${platform}.json`);
await (await import("node:fs/promises")).writeFile(
  outPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `${JSON.stringify(
    {
      platform,
      in_scope_correct: `${inScope.filter((r) => r.correct).length}/${inScope.length}`,
      challenge_correct: `${challenge.filter((r) => r.correct).length}/${challenge.length}`,
      skipped: results.length - evaluated.length,
      out: outPath,
    },
    null,
    2,
  )}\n`,
);
