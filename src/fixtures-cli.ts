#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { Command } from "commander";
import { canonicalJsonString } from "./backend/digest.js";
import { collectBackendQualificationFacts } from "./backend/qualification-collector.js";
import { judgeBackendQualification } from "./backend/qualification-policy.js";
import {
  buildBackendQualificationReceipt,
  type DeclaredBackendHostEnvironment,
} from "./backend/qualification-receipt.js";
import type { BackendTransport } from "./backend/ssh-backend-transport.js";
import { createSshBackendTransport } from "./backend/ssh-backend-transport.js";
import type { PathFamilyCasePlan } from "./experiment-runner/path-family.js";
import { DEV_PATH_001_PLAN, runPathFamilyExperiment } from "./experiment-runner/path-family.js";
import {
  buildVerificationLedger,
  verificationLedgerSha256,
} from "./experiment-runner/proof-ledger.js";
import { verifyVerificationLedger } from "./experiment-runner/proof-ledger-verifier.js";
import { currentProcessController } from "./supervised-process.js";

/**
 * Protocol amendment (docs/adr/0005): the ledger binds the manifest by its
 * EVIDENCE PROJECTION digest — canonical JSON minus the promotion fields
 * (fixture_status, verified_at, backend_qualification slot, verification_ledger
 * slot) — mirroring fixtures/lib/evidence-verifier.mjs. Promotion changes
 * status fields without invalidating the bound evidence.
 */
function manifestEvidenceSha256(manifest: unknown): string {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("RP_MANIFEST_PROJECTION_INVALID");
  }
  const clone = structuredClone(manifest) as Record<string, unknown>;
  delete clone["fixture_status"];
  const implementation = clone["implementation"];
  if (
    implementation !== null &&
    typeof implementation === "object" &&
    !Array.isArray(implementation)
  ) {
    const implementationClone = implementation as Record<string, unknown>;
    delete implementationClone["verified_at"];
    const receipts = implementationClone["receipts"];
    if (receipts !== null && typeof receipts === "object" && !Array.isArray(receipts)) {
      const receiptsClone = receipts as Record<string, unknown>;
      delete receiptsClone["backend_qualification"];
      delete receiptsClone["verification_ledger"];
    }
  }
  return createHash("sha256").update(canonicalJsonString(clone), "utf8").digest("hex");
}

const RUNNER_VERSION = "runparity-fixtures/0.1.0";

type BackendConfigFile = Readonly<{
  ssh: Readonly<{
    executablePath: string;
    host: string;
    port: number;
    user: string;
    identityFile: string;
    knownHostsFile: string;
    connectTimeoutSeconds: number;
    workingDirectory: string;
  }>;
  backend: Readonly<{
    imageDigestRef: string;
    imageAcquisitionMirror: string;
    vmUserUid: number;
    vmUserGid: number;
    probeHostDir: string;
    assetsHostRoot: string;
    armsHostRoot: string;
  }>;
  declaredHost: DeclaredBackendHostEnvironment;
}>;

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJsonArtifact(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

function buildTransport(config: BackendConfigFile): BackendTransport {
  const ssh = config.ssh;
  if (!isAbsolute(ssh.executablePath)) {
    throw new Error("RP_FIXTURES_CONFIG: ssh.executablePath must be absolute");
  }
  if (!existsSync(ssh.executablePath)) {
    throw new Error(`RP_FIXTURES_CONFIG: ssh executable not found: ${ssh.executablePath}`);
  }
  return createSshBackendTransport(
    {
      sshExecutablePath: ssh.executablePath,
      host: ssh.host,
      port: ssh.port,
      user: ssh.user,
      identityFile: ssh.identityFile,
      knownHostsFile: ssh.knownHostsFile,
      connectTimeoutSeconds: ssh.connectTimeoutSeconds,
      workingDirectory: ssh.workingDirectory,
    },
    currentProcessController(),
  );
}

function monotonicNowNanoseconds(): bigint {
  return process.hrtime.bigint();
}

const program = new Command().name("runparity-fixtures").version("0.1.0");

program
  .command("backend")
  .description("Backend qualification operations")
  .command("qualify")
  .requiredOption("--config <path>", "backend config JSON")
  .requiredOption("--out <path>", "receipt output JSON path")
  .requiredOption("--facts-out <path>", "facts sidecar JSON path")
  .action((options: { config: string; out: string; factsOut: string }) => {
    void (async () => {
      const config = loadJson(options.config) as BackendConfigFile;
      const transport = buildTransport(config);
      const totalBudget = 300n * 1000n * 1000n * 1000n;
      const start = monotonicNowNanoseconds();
      const facts = await collectBackendQualificationFacts(transport, {
        imageDigestRef: config.backend.imageDigestRef,
        imageAcquisitionMirror: config.backend.imageAcquisitionMirror,
        vmUserUid: config.backend.vmUserUid,
        vmUserGid: config.backend.vmUserGid,
        probeHostDir: config.backend.probeHostDir,
        armsHostRoot: config.backend.armsHostRoot,
        totalDeadlineNanoseconds: start + totalBudget,
        nowNanoseconds: monotonicNowNanoseconds,
      });
      const judgment = judgeBackendQualification(facts);
      const built = buildBackendQualificationReceipt({
        facts,
        judgment,
        declaredHost: config.declaredHost,
        qualifiedAtIso: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
      });
      writeJsonArtifact(options.out, built.receipt);
      writeJsonArtifact(options.factsOut, facts);
      process.stderr.write(
        `backend qualification: ${judgment.overall}\n` +
          judgment.controls
            .map((control) => `  ${control.status.padEnd(14)} ${control.id}: ${control.reason}`)
            .join("\n") +
          "\n",
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            schema_version: "runparity.fixtures-backend-qualify/v1",
            overall: judgment.overall,
            receipt_sha256: built.receipt_sha256,
            blocking: judgment.blocking,
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = judgment.overall === "qualified" ? 0 : 1;
    })().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  });

type CaseRunOptions = {
  case: string;
  config: string;
  receipt: string;
  out: string;
  verifiedAt?: string;
};

program
  .command("case")
  .description("Fixture case operations")
  .command("run")
  .requiredOption("--case <id>", "case id, e.g. DEV-PATH-001")
  .requiredOption("--config <path>", "backend config JSON")
  .requiredOption("--receipt <path>", "backend qualification receipt JSON")
  .requiredOption("--out <path>", "ledger output JSON path")
  .option(
    "--verified-at <timestamp>",
    "pin the ledger verified_at (UTC, seconds precision) to the manifest promotion timestamp",
  )
  .action((options: CaseRunOptions) => {
    void (async () => {
      const receipt = loadJson(options.receipt) as {
        status?: string;
        policy_digest?: string;
        image_digest?: string;
      };
      if (receipt.status !== "qualified") {
        throw new Error("RP_CASE_RUN_BACKEND_NOT_QUALIFIED");
      }
      const receiptFileSha = sha256File(options.receipt);
      const config = loadJson(options.config) as BackendConfigFile;
      const transport = buildTransport(config);

      const plans: Readonly<Record<string, PathFamilyCasePlan>> = {
        "DEV-PATH-001": DEV_PATH_001_PLAN,
      };
      const plan = plans[options.case];
      if (plan === undefined) {
        throw new Error(`RP_CASE_RUN_UNSUPPORTED_CASE:${options.case}`);
      }
      const manifestSha = manifestEvidenceSha256(
        loadJson(`fixtures/development/cases/${options.case}.json`),
      );
      const buildReceiptSha = sha256File(`fixtures/receipts/build/${options.case}.json`);

      const freshness: Readonly<Record<"a1" | "b" | "a2", string>>[] = [1, 2, 3].map((sequence) => {
        const stamp = Date.now().toString(36);
        return {
          a1: `s${sequence}-a1-${stamp}`,
          b: `s${sequence}-b-${stamp}`,
          a2: `s${sequence}-a2-${stamp}`,
        };
      });

      const records = await runPathFamilyExperiment(
        transport,
        {
          imageDigestRef: config.backend.imageDigestRef,
          assetsHostRoot: `${config.backend.assetsHostRoot.replace(/\/+$/u, "")}/${plan.assetSubdir}`,
          armsHostRoot: config.backend.armsHostRoot,
          perArmDeadlineNanoseconds: 180n * 1000n * 1000n * 1000n,
          nowNanoseconds: monotonicNowNanoseconds,
        },
        plan,
        freshness,
      );

      const oracle = {
        type: "exit_code_and_stdout" as const,
        exit_code: 0,
        stdout_contains: "RUNPARITY_OK:dev-path-001",
      };
      const ledger = buildVerificationLedger({
        caseId: plan.caseId,
        manifestSha256: manifestSha,
        buildReceiptSha256: buildReceiptSha,
        backendQualificationSha256: receiptFileSha,
        backendImageDigest: digestFromReceipt(receipt),
        armIsolationPolicyDigest: receipt.policy_digest ?? "",
        oracle,
        intervention: { type: "path.prepend", directory: plan.interventionDirectory },
        records,
        runnerVersion: RUNNER_VERSION,
        verifiedAtIso:
          options.verifiedAt !== undefined
            ? (() => {
                if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(options.verifiedAt)) {
                  throw new Error("RP_CASE_RUN_INVALID_VERIFIED_AT");
                }
                return options.verifiedAt;
              })()
            : new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
      });
      const candidateVerdict = verifyVerificationLedger({ ...ledger, status: "passed" });
      const passed =
        records.every(
          (record) => record.outcome === "completed" && record.post_run_container_absent === true,
        ) && candidateVerdict.verdict === "VERIFIED_INTERVENTION";
      const finalLedger = { ...ledger, status: passed ? ("passed" as const) : ("failed" as const) };
      writeJsonArtifact(options.out, finalLedger);
      const verdict = verifyVerificationLedger(finalLedger);
      process.stdout.write(
        `${JSON.stringify(
          {
            schema_version: "runparity.fixtures-case-run/v1",
            case: plan.caseId,
            verdict: verdict.verdict,
            ledger_sha256: verificationLedgerSha256(finalLedger),
            blocking: verdict.verdict === "PARTIAL_EVIDENCE" ? verdict.blocking : [],
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = verdict.verdict === "VERIFIED_INTERVENTION" ? 0 : 1;
    })().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  });

function digestFromReceipt(receipt: { image_digest?: string }): string {
  if (
    typeof receipt.image_digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(receipt.image_digest)
  ) {
    throw new Error("RP_CASE_RUN_RECEIPT_IMAGE_DIGEST_INVALID");
  }
  return receipt.image_digest;
}

program
  .command("suite")
  .description("Suite status operations")
  .command("status")
  .action(() => {
    const index = loadJson("fixtures/development/index.json") as {
      status?: string;
      cases?: unknown[];
    };
    process.stdout.write(
      `${JSON.stringify(
        {
          schema_version: "runparity.fixtures-suite-status/v1",
          suite_status: index.status ?? null,
          case_count: Array.isArray(index.cases) ? index.cases.length : null,
        },
        null,
        2,
      )}\n`,
    );
  });

await program.parseAsync(process.argv);
