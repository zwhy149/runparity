import { describe, expect, test } from "vitest";
import type {
  BackendTransport,
  BackendTransportCompletion,
} from "../src/backend/ssh-backend-transport.js";
import { DEV_PATH_001_PLAN } from "../src/experiment-runner/case-plans.js";
import { type ArmRunRecord, runIsolatedArm } from "../src/experiment-runner/isolated-arm-runner.js";
import { buildVerificationLedger } from "../src/experiment-runner/proof-ledger.js";
import { verifyVerificationLedger } from "../src/experiment-runner/proof-ledger-verifier.js";

const IMAGE = `docker.m.daocloud.io/library/node@sha256:${"b".repeat(64)}`;

type ArmBehavior = (
  armName: string,
  pathEnv: string | null,
) => { exitCode: number; stdout: string; stderr: string };

function defaultArmBehavior(): ArmBehavior {
  return (_armName, pathEnv) => {
    if (pathEnv?.startsWith("PATH=/arm/assets/intended-node/bin:")) {
      return { exitCode: 0, stdout: "RUNPARITY_OK:dev-path-001\n", stderr: "" };
    }
    return { exitCode: 23, stdout: "", stderr: "RP_FIXTURE_WRONG_NODE_PATH\n" };
  };
}

function createScriptedTransport(
  behavior: ArmBehavior,
  options: { leftoverContainers?: unknown[]; refuseRuns?: boolean } = {},
): BackendTransport {
  const _now = () => process.hrtime.bigint();
  return Object.freeze({
    async run(command: { args: readonly string[] }): Promise<BackendTransportCompletion> {
      const args = command.args;
      const first = args[0] ?? "";
      if (first === "rm" || first === "mkdir") {
        return {
          kind: "completed",
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 3,
          cleanupStatus: "not_required",
        };
      }
      if (first === "podman") {
        if (args[1] === "run") {
          if (options.refuseRuns === true) {
            return {
              kind: "refused",
              reasonCode: "RP_BACKEND_TRANSPORT_DEADLINE_DURING_EXECUTION",
              detail: "test",
            };
          }
          const pathEnv = args.find((token) => token.startsWith("PATH=")) ?? null;
          const armName = args[args.indexOf("--name") + 1] ?? "unknown";
          const outcome = behavior(armName, pathEnv);
          return {
            kind: "completed",
            exitCode: outcome.exitCode,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
            durationMs: 812,
            cleanupStatus: "not_required",
          };
        }
        if (args[1] === "ps") {
          return {
            kind: "completed",
            exitCode: 0,
            stdout: JSON.stringify(options.leftoverContainers ?? []),
            stderr: "",
            durationMs: 12,
            cleanupStatus: "not_required",
          };
        }
      }
      return {
        kind: "completed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        cleanupStatus: "not_required",
      };
    },
  });
}

const BACKEND = {
  imageDigestRef: IMAGE,
  assetsHostRoot: "/home/rp/assets/DEV-PATH-001",
  armsHostRoot: "/home/rp/arms",
  perArmDeadlineNanoseconds: 180n * 10n ** 9n,
  nowNanoseconds: () => process.hrtime.bigint(),
};

async function runFullSequence(transport: BackendTransport): Promise<ArmRunRecord[]> {
  const records: ArmRunRecord[] = [];
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    for (const identity of ["A1", "B", "A2"] as const) {
      records.push(
        await runIsolatedArm(transport, BACKEND, {
          identity,
          sequenceIndex: sequence,
          caseSlug: "rp-dev-path-001",
          freshnessId: `s${sequence}-${identity.toLowerCase()}`,
          environment:
            identity === "B"
              ? DEV_PATH_001_PLAN.intervention.environment
              : DEV_PATH_001_PLAN.baseline.environment,
          targetArgv: DEV_PATH_001_PLAN.baseline.targetArgv,
          workingDirectory: DEV_PATH_001_PLAN.workingDirectory,
        }),
      );
    }
  }
  return records;
}

function buildLedger(records: ArmRunRecord[], status: "passed" | "failed" = "passed") {
  const ledger = buildVerificationLedger({
    caseId: "DEV-PATH-001",
    family: DEV_PATH_001_PLAN.family,
    manifestSha256: "1".repeat(64),
    buildReceiptSha256: "2".repeat(64),
    backendQualificationSha256: "3".repeat(64),
    backendImageDigest: `sha256:${"b".repeat(64)}`,
    armIsolationPolicyDigest: "4".repeat(64),
    oracle: DEV_PATH_001_PLAN.oracle,
    intervention: DEV_PATH_001_PLAN.interventionDescriptor,
    records,
    runnerVersion: "runparity-fixtures/test",
    verifiedAtIso: "2026-08-22T12:00:00Z",
  });
  return { ...ledger, status };
}

describe("A1/B/A2 proof ledger", () => {
  test("a clean (A1->B->A2)x3 sequence verifies the intervention", async () => {
    const records = await runFullSequence(createScriptedTransport(defaultArmBehavior()));
    const ledger = buildLedger(records);
    const verdict = verifyVerificationLedger(ledger);
    expect(verdict.verdict).toBe("VERIFIED_INTERVENTION");
  });

  test("B without the path.prepend delta fails the oracle and blocks verification", async () => {
    const records = await runFullSequence(
      createScriptedTransport((_armName, _pathEnv) => ({
        exitCode: 23,
        stdout: "",
        stderr: "RP_FIXTURE_WRONG_NODE_PATH\n",
      })),
    );
    const verdict = verifyVerificationLedger(buildLedger(records));
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
    if (verdict.verdict === "PARTIAL_EVIDENCE") {
      expect(verdict.blocking.some((reason) => reason.includes("B_oracle_not_satisfied"))).toBe(
        true,
      );
    }
  });

  test("an A2 that stops reproducing the failure blocks verification", async () => {
    const behavior: ArmBehavior = (armName, pathEnv) => {
      if (armName.endsWith("-a2")) {
        return { exitCode: 0, stdout: "RUNPARITY_OK:dev-path-001\n", stderr: "" };
      }
      return defaultArmBehavior()(armName, pathEnv);
    };
    const records = await runFullSequence(createScriptedTransport(behavior));
    const verdict = verifyVerificationLedger(buildLedger(records));
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
    if (verdict.verdict === "PARTIAL_EVIDENCE") {
      expect(
        verdict.blocking.some(
          (reason) =>
            reason.includes("signature_unstable") || reason.includes("unexpected_success"),
        ),
      ).toBe(true);
    }
  });

  test("a second undeclared delta in B blocks the single-intervention diff", async () => {
    const clean = await runFullSequence(createScriptedTransport(defaultArmBehavior()));
    const records = clean.map((record) =>
      record.identity === "B"
        ? { ...record, normalized_argv: [...record.normalized_argv, "-e", "EXTRA=undeclared"] }
        : record,
    );
    const verdict = verifyVerificationLedger(buildLedger(records));
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
    if (verdict.verdict === "PARTIAL_EVIDENCE") {
      expect(verdict.blocking.some((reason) => reason.includes("intervention_diff_invalid"))).toBe(
        true,
      );
    }
  });

  test("a tampered embedded signature is re-derived and rejected", async () => {
    const records = await runFullSequence(createScriptedTransport(defaultArmBehavior()));
    const ledger = buildLedger(records);
    const tampered = structuredClone(ledger);
    const a1 = tampered.sequences[0]?.arms[0];
    if (a1 !== undefined && a1.signature !== null) {
      (a1 as unknown as { signature: unknown }).signature = { ...a1.signature, exit_code: 99 };
    }
    const verdict = verifyVerificationLedger(tampered);
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
    if (verdict.verdict === "PARTIAL_EVIDENCE") {
      expect(verdict.blocking.some((reason) => reason.includes("signature_mismatch"))).toBe(true);
    }
  });

  test("surviving containers block verification as a safety failure", async () => {
    const records = await runFullSequence(
      createScriptedTransport(defaultArmBehavior(), { leftoverContainers: [{ Names: "left" }] }),
    );
    const verdict = verifyVerificationLedger(buildLedger(records));
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
    if (verdict.verdict === "PARTIAL_EVIDENCE") {
      expect(verdict.blocking.some((reason) => reason.includes("container_leftover"))).toBe(true);
    }
  });

  test("a refused arm transport blocks verification", async () => {
    const records = await runFullSequence(
      createScriptedTransport(defaultArmBehavior(), { refuseRuns: true }),
    );
    const verdict = verifyVerificationLedger(buildLedger(records));
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
  });

  test("ledger status must be passed for verification", async () => {
    const records = await runFullSequence(createScriptedTransport(defaultArmBehavior()));
    const verdict = verifyVerificationLedger(buildLedger(records, "failed"));
    expect(verdict.verdict).toBe("PARTIAL_EVIDENCE");
  });
});
