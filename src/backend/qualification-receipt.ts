import { canonicalJsonString, canonicalSha256Hex, sha256Hex } from "./digest.js";
import type { BackendQualificationFactsV1 } from "./qualification-collector.js";
import type { QualificationJudgment } from "./qualification-policy.js";

/**
 * Backend qualification receipt.
 *
 * A receipt is derived, never authored: it binds the collected facts, the
 * pure policy judgment, the arm isolation policy digest, and declared
 * (non-probed) host environment facts into one canonical record whose digest
 * downstream ledgers must reference. Writing a receipt file does not by
 * itself authorize anything; the fixture validator re-derives every claim
 * from the receipt chain before a verified status is accepted.
 */

export type DeclaredBackendHostEnvironment = Readonly<{
  class: string;
  boot_image: string;
  hypervisor_chain: string;
  note: string;
}>;

export type BackendQualificationReceiptV1 = Readonly<{
  schema_version: "runparity.backend-qualification-receipt/v1";
  receipt_version: 1;
  backend: "linux_rootless_oci";
  status: "qualified" | "unqualified";
  platform: Readonly<{ os: "linux"; arch: "amd64"; libc: "glibc" }>;
  engine: Readonly<{
    name: "podman";
    version: string;
    api_version: string;
    rootless: boolean | null;
    cgroup_version: string | null;
    cgroup_controllers: readonly string[] | null;
  }>;
  host_vm: Readonly<{
    declared: DeclaredBackendHostEnvironment;
    declaration_only: true;
    observed: Readonly<{
      kernel: string;
      os_release_pretty: string;
      user_uid: string;
      user_gid: string;
    }>;
  }>;
  image_digest: string;
  image_digest_ref: string;
  image_acquisition_mirror: string;
  image_id: string | null;
  policy_digest: string;
  arm_isolation_policy_digest: string;
  controls: Readonly<
    {
      id: string;
      status: string;
      reason: string;
    }[]
  >;
  facts_sha256: string;
  judgment_sha256: string;
  qualified_at: string;
  collector_version: number;
}>;

export type BuiltBackendQualificationReceipt = Readonly<{
  receipt: BackendQualificationReceiptV1;
  receipt_sha256: string;
  facts: BackendQualificationFactsV1;
}>;

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

export function buildBackendQualificationReceipt(
  input: Readonly<{
    facts: BackendQualificationFactsV1;
    judgment: QualificationJudgment;
    declaredHost: DeclaredBackendHostEnvironment;
    qualifiedAtIso: string;
  }>,
): BuiltBackendQualificationReceipt {
  if (!UTC_PATTERN.test(input.qualifiedAtIso)) {
    throw new Error("RP_BACKEND_RECEIPT_INVALID_TIMESTAMP");
  }
  if (input.judgment.overall !== "qualified" && input.judgment.overall !== "unqualified") {
    throw new Error("RP_BACKEND_RECEIPT_INVALID_JUDGMENT");
  }
  const digestPart = input.facts.image_digest_ref.split("@", 2)[1] ?? "";
  if (!/^sha256:[a-f0-9]{64}$/u.test(digestPart)) {
    throw new Error("RP_BACKEND_RECEIPT_INVALID_IMAGE_DIGEST");
  }
  const factsSha256 = sha256Hex(canonicalJsonString(input.facts));
  const judgmentSha256 = sha256Hex(canonicalJsonString(input.judgment));
  const receipt: BackendQualificationReceiptV1 = Object.freeze({
    schema_version: "runparity.backend-qualification-receipt/v1",
    receipt_version: 1,
    backend: "linux_rootless_oci",
    status: input.judgment.overall,
    platform: Object.freeze({ os: "linux", arch: "amd64", libc: "glibc" }),
    engine: Object.freeze({
      name: "podman",
      version: input.facts.engine.version,
      api_version: input.facts.engine.api_version,
      rootless: input.facts.engine.rootless,
      cgroup_version: input.facts.engine.cgroup_version,
      cgroup_controllers: input.facts.engine.cgroup_controllers,
    }),
    host_vm: Object.freeze({
      declared: Object.freeze(input.declaredHost),
      declaration_only: true,
      observed: Object.freeze({
        kernel: input.facts.vm_identity.kernel,
        os_release_pretty: input.facts.vm_identity.os_release_pretty,
        user_uid: input.facts.vm_identity.user_uid,
        user_gid: input.facts.vm_identity.user_gid,
      }),
    }),
    image_digest: digestPart,
    image_digest_ref: input.facts.image_digest_ref,
    image_acquisition_mirror: input.facts.image_acquisition_mirror,
    image_id: input.facts.image.image_id,
    policy_digest: `sha256:${input.facts.arm_isolation_policy_digest}`,
    arm_isolation_policy_digest: input.facts.arm_isolation_policy_digest,
    controls: Object.freeze(
      input.judgment.controls.map((control) =>
        Object.freeze({
          id: control.id,
          status: control.status,
          reason: control.reason,
        }),
      ),
    ),
    facts_sha256: factsSha256,
    judgment_sha256: judgmentSha256,
    qualified_at: input.qualifiedAtIso,
    collector_version: input.facts.collector_version,
  });
  return Object.freeze({
    receipt,
    receipt_sha256: canonicalSha256Hex(receipt),
    facts: input.facts,
  });
}
