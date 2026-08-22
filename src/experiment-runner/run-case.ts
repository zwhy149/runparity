import type { BackendTransport } from "../backend/ssh-backend-transport.js";
import type { CasePlan } from "./case-plans.js";
import { type ArmBackendConfig, type ArmRunRecord, runIsolatedArm } from "./isolated-arm-runner.js";

/**
 * Generic case experiment runner: executes (A1 -> B -> A2) x repetitions for
 * any registered case plan, verifying declared external artifacts first.
 */

export type ExternalArtifactEvidence = Readonly<{
  role: string;
  host_path: string;
  expected_sha256: string;
  observed_sha256: string | null;
  verified: boolean;
}>;

export type CaseRunOutcome = Readonly<{
  records: readonly ArmRunRecord[];
  external_artifacts: readonly ExternalArtifactEvidence[];
}>;

const HEX64 = /^[a-f0-9]{64}$/u;

export async function runCaseExperiment(
  transport: BackendTransport,
  backend: ArmBackendConfig,
  plan: CasePlan,
  freshnessIds: Readonly<Record<"a1" | "b" | "a2", string>>[],
): Promise<CaseRunOutcome> {
  if (freshnessIds.length !== plan.repetitions) {
    throw new Error("RP_CASE_PLAN_REPETITION_MISMATCH");
  }
  const assetsRoot = `${backend.assetsHostRoot.replace(/\/+$/u, "")}/${plan.assetSubdir}`;

  const artifacts: ExternalArtifactEvidence[] = [];
  for (const artifact of plan.externalArtifacts ?? []) {
    if (!HEX64.test(artifact.sha256)) {
      throw new Error(`RP_CASE_EXTERNAL_ARTIFACT_DIGEST_INVALID:${artifact.role}`);
    }
    const completion = await transport.run({
      args: ["sha256sum", artifact.hostPath],
      deadlineNanoseconds: backend.nowNanoseconds() + 20n * 1000n * 1000n * 1000n,
    });
    const observed =
      completion.kind === "completed"
        ? (/^([a-f0-9]{64})\s/u.exec(completion.stdout.trim())?.[1] ?? null)
        : null;
    artifacts.push(
      Object.freeze({
        role: artifact.role,
        host_path: artifact.hostPath,
        expected_sha256: artifact.sha256,
        observed_sha256: observed ?? "",
        verified: observed === artifact.sha256,
      }),
    );
  }
  if (artifacts.some((artifact) => !artifact.verified)) {
    throw new Error("RP_CASE_EXTERNAL_ARTIFACT_DIGEST_MISMATCH");
  }

  const records: ArmRunRecord[] = [];
  for (let sequence = 1; sequence <= plan.repetitions; sequence += 1) {
    const ids = freshnessIds[sequence - 1];
    if (ids === undefined) {
      throw new Error("RP_CASE_PLAN_FRESHNESS_MISSING");
    }
    const roles = [
      { identity: "A1" as const, spec: plan.baseline, freshnessId: ids.a1 },
      { identity: "B" as const, spec: plan.intervention, freshnessId: ids.b },
      { identity: "A2" as const, spec: plan.baseline, freshnessId: ids.a2 },
    ];
    for (const role of roles) {
      records.push(
        await runIsolatedArm(
          transport,
          { ...backend, assetsHostRoot: assetsRoot },
          {
            identity: role.identity,
            sequenceIndex: sequence,
            caseSlug: plan.caseSlug,
            freshnessId: role.freshnessId,
            environment: role.spec.environment,
            targetArgv: role.spec.targetArgv,
            workingDirectory: plan.workingDirectory,
            ...(role.spec.homePrep === undefined ? {} : { homePrep: role.spec.homePrep }),
            ...(role.spec.extraMounts === undefined ? {} : { extraMounts: role.spec.extraMounts }),
          },
        ),
      );
    }
  }
  return Object.freeze({ records, external_artifacts: Object.freeze(artifacts) });
}
