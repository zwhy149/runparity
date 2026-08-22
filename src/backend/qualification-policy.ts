import type { BackendQualificationFactsV1 } from "./qualification-collector.js";

/**
 * Pure backend qualification policy.
 *
 * Turns collected facts into per-control judgments. This module runs no
 * commands, reads no files, and issues no authorization by itself: only the
 * receipt verifier accepts a fully-demonstrated control set as a qualified
 * backend, and only for the exact digests recorded with it.
 */

export type QualificationControlStatus = "demonstrated" | "missing" | "contradictory" | "ambiguous";

export type QualificationControlId =
  | "vm_user_non_root"
  | "engine_rootless"
  | "image_identity"
  | "arm_privilege_floor"
  | "rootfs_read_only"
  | "write_containment"
  | "network_denial"
  | "credentials_absent"
  | "resource_limits"
  | "detached_destroy"
  | "cross_arm_freshness";

export type QualificationControlJudgment = Readonly<{
  id: QualificationControlId;
  status: QualificationControlStatus;
  reason: string;
}>;

export type QualificationJudgment = Readonly<{
  schema_version: "runparity.backend-qualification-judgment/v1";
  policy_version: 1;
  controls: readonly QualificationControlJudgment[];
  overall: "qualified" | "unqualified";
  blocking: readonly string[];
}>;

const IMMEDIATE_UNREACHABLE_CODES = new Set([
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ENETDOWN",
  "EAFNOSUPPORT",
  "EPERM",
]);

type NetworkResult = { target?: unknown; outcome?: unknown; error_code?: unknown };

function probeRecord(
  facts: BackendQualificationFactsV1,
  key: ProbeKey,
): Record<string, unknown> | null {
  const probe = facts[key];
  if (probe === null || typeof probe !== "object" || probe.state !== "collected") {
    return null;
  }
  return asRecord(probe.parsed);
}

type ProbeKey = "readonly_write" | "network_denial" | "credentials_absent" | "resource_limits";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function judged(
  id: QualificationControlId,
  status: QualificationControlStatus,
  reason: string,
): QualificationControlJudgment {
  return Object.freeze({ id, status, reason });
}

function judgeVmUserNonRoot(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  if (facts.vm_identity.user_uid === "0" || facts.vm_identity.user_gid === "0") {
    return judged("vm_user_non_root", "contradictory", "backend account is root");
  }
  if (!/^\d+$/u.test(facts.vm_identity.user_uid) || !/^\d+$/u.test(facts.vm_identity.user_gid)) {
    return judged("vm_user_non_root", "missing", "uid/gid facts absent");
  }
  return judged(
    "vm_user_non_root",
    "demonstrated",
    `backend account uid=${facts.vm_identity.user_uid}`,
  );
}

function judgeEngineRootless(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  if (facts.engine.rootless === false) {
    return judged("engine_rootless", "contradictory", "podman reports rootless=false");
  }
  if (facts.engine.rootless !== true) {
    return judged("engine_rootless", "missing", "podman rootless fact absent");
  }
  if (
    facts.engine.id_mappings_uid === null ||
    facts.engine.id_mappings_uid.length === 0 ||
    facts.engine.id_mappings_gid === null ||
    facts.engine.id_mappings_gid.length === 0
  ) {
    return judged("engine_rootless", "missing", "user namespace id mappings absent");
  }
  return judged(
    "engine_rootless",
    "demonstrated",
    `podman rootless with uid mapping entries=${facts.engine.id_mappings_uid.length}`,
  );
}

function judgeImageIdentity(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const { image } = facts;
  // Podman reports bare hex image ids; the digest reference carries the
  // algorithm prefix. Both forms are accepted and never conflated.
  const imageIdPattern = /^(?:sha256:)?[a-f0-9]{64}$/u;
  if (image.image_id === null || !imageIdPattern.test(image.image_id)) {
    return judged("image_identity", "missing", "image id fact absent");
  }
  if (image.os !== "linux" || image.architecture !== "amd64") {
    return judged(
      "image_identity",
      "contradictory",
      `image platform ${image.os ?? "?"}/${image.architecture ?? "?"} is not linux/amd64`,
    );
  }
  if (
    image.repo_digests === null ||
    !image.repo_digests.some(
      (entry) =>
        entry === facts.image_digest_ref ||
        entry.endsWith(facts.image_digest_ref.split("@", 2)[1] ?? ""),
    )
  ) {
    return judged(
      "image_identity",
      "missing",
      "repo digests do not pin the configured digest reference",
    );
  }
  return judged("image_identity", "demonstrated", `image pinned to ${facts.image_digest_ref}`);
}

function parseStatusQuad(text: string, key: string): readonly string[] | null {
  for (const line of text.split("\n")) {
    if (line.startsWith(`${key}:`)) {
      const values = line
        .slice(key.length + 1)
        .trim()
        .split(/\s+/u);
      if (values.length === 4) {
        return values;
      }
    }
  }
  return null;
}

function parseStatusScalar(text: string, key: string): string | null {
  for (const line of text.split("\n")) {
    if (line.startsWith(`${key}:`)) {
      return line.slice(key.length + 1).trim();
    }
  }
  return null;
}

function parseUidMapEntries(
  text: string,
): readonly { inside: string; outside: string; length: string }[] {
  const entries: { inside: string; outside: string; length: string }[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    if (match !== null) {
      entries.push({ inside: match[1] ?? "", outside: match[2] ?? "", length: match[3] ?? "" });
    }
  }
  return Object.freeze(entries);
}

function judgeArmPrivilegeFloor(
  facts: BackendQualificationFactsV1,
  armUserUid: string,
  _armUserGid: string,
): QualificationControlJudgment {
  const probe = facts.privilege_probe;
  if (!probe.bundle_decoded) {
    return judged("arm_privilege_floor", "missing", "privilege probe bundle could not be decoded");
  }
  const classification = asRecord(probe.classification);
  const classificationState =
    typeof classification?.["kind"] === "string"
      ? classification["kind"]
      : typeof classification?.["state"] === "string"
        ? classification["state"]
        : null;
  const state = classificationState;

  if (state === "no_contradiction_in_privilege_subset") {
    return judged(
      "arm_privilege_floor",
      "demonstrated",
      "in-arm uid/gid non-root, capabilities zero, no-new-privileges, mappings present",
    );
  }

  // Rootless Podman exposes the container uid_map in nested user-namespace
  // coordinates: the invoking unprivileged VM user appears as 0 there, which
  // the OCI privilege policy correctly flags as parent_root_*_mapped instead
  // of trusting the protocol claim (ADR-0004). Qualification binds that claim
  // with kernel truth read from the VM host for the live arm process: real
  // uid/gid, capability masks, NoNewPrivs, and the host-side uid_map.
  if (state === "contradictory") {
    const contradictions = asArray(classification?.["contradictions"]);
    const onlyParentRoot =
      contradictions !== null &&
      contradictions.length > 0 &&
      contradictions.every(
        (code) => code === "parent_root_uid_mapped" || code === "parent_root_gid_mapped",
      );
    if (onlyParentRoot) {
      const binding = facts.parent_binding;
      if (
        binding.ran_detached &&
        binding.host_status_text !== null &&
        binding.host_uid_map_text !== null
      ) {
        const uidQuad = parseStatusQuad(binding.host_status_text, "Uid");
        const gidQuad = parseStatusQuad(binding.host_status_text, "Gid");
        const capEff = parseStatusScalar(binding.host_status_text, "CapEff");
        const noNewPrivs = parseStatusScalar(binding.host_status_text, "NoNewPrivs");
        const entries = parseUidMapEntries(binding.host_uid_map_text);
        const vmUid = facts.vm_identity.user_uid;
        const vmGid = facts.vm_identity.user_gid;
        const realIdsBound =
          uidQuad !== null &&
          gidQuad !== null &&
          uidQuad.every((value) => value === vmUid) &&
          gidQuad.every((value) => value === vmGid);
        const capsBound = capEff === "0000000000000000";
        const nnpBound = noNewPrivs === "1";
        const selfEntry = entries.find((entry) => entry.inside === armUserUid);
        const selfBound =
          selfEntry !== undefined && selfEntry.outside === vmUid && selfEntry.length === "1";
        const noRealRootMapped = entries.every((entry) => entry.outside !== "0");
        if (realIdsBound && capsBound && nnpBound && selfBound && noRealRootMapped) {
          return judged(
            "arm_privilege_floor",
            "demonstrated",
            `nested-userns parent claim bound by host kernel truth: arm uid ${armUserUid} maps to VM uid ${vmUid}; caps 0; NoNewPrivs 1`,
          );
        }
        return judged(
          "arm_privilege_floor",
          "contradictory",
          "parent binding incomplete: host kernel view did not confirm unprivileged identity",
        );
      }
      return judged(
        "arm_privilege_floor",
        "missing",
        "parent_root mapping flagged and no host-side binding facts collected",
      );
    }
    return judged(
      "arm_privilege_floor",
      "contradictory",
      `privilege subset contradictions: ${contradictions?.join(",") ?? "unknown"}`,
    );
  }
  if (state === "ambiguous") {
    return judged(
      "arm_privilege_floor",
      "contradictory",
      "privilege subset classification: ambiguous",
    );
  }
  return judged(
    "arm_privilege_floor",
    "missing",
    `privilege subset classification: ${state ?? "unknown"}`,
  );
}

function judgeRootfsReadOnly(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const record = probeRecord(facts, "readonly_write");
  const attempts = asArray(record?.["attempts"]);
  if (attempts === null) {
    return judged("rootfs_read_only", "missing", "readonly/write probe facts absent");
  }
  const findAttempt = (target: string) =>
    attempts.find((entry) => (asRecord(entry)?.["target"] as string | undefined) === target);
  const rootAttempt = asRecord(findAttempt("root_filesystem"));
  const roMountAttempt = asRecord(findAttempt("read_only_mount"));
  if (rootAttempt?.["outcome"] === "refused" && roMountAttempt?.["outcome"] === "refused") {
    return judged(
      "rootfs_read_only",
      "demonstrated",
      `root and read-only mount writes refused (${rootAttempt["error_code"] ?? "?"}/${roMountAttempt["error_code"] ?? "?"})`,
    );
  }
  if (rootAttempt?.["outcome"] === "wrote" || roMountAttempt?.["outcome"] === "wrote") {
    return judged("rootfs_read_only", "contradictory", "a write outside approved mounts succeeded");
  }
  return judged("rootfs_read_only", "missing", "write-attempt facts incomplete");
}

function judgeWriteContainment(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const record = probeRecord(facts, "readonly_write");
  const attempts = asArray(record?.["attempts"]);
  if (attempts === null) {
    return judged("write_containment", "missing", "readonly/write probe facts absent");
  }
  const byTarget = new Map<string, Record<string, unknown>>();
  for (const entry of attempts) {
    const parsed = asRecord(entry);
    const target = typeof parsed?.["target"] === "string" ? parsed["target"] : null;
    if (target !== null && parsed !== null) {
      byTarget.set(target, parsed);
    }
  }
  const home = byTarget.get("writable_arm_home");
  const tmp = byTarget.get("writable_tmpfs");
  if (home?.["outcome"] !== "wrote" || tmp?.["outcome"] !== "wrote") {
    return judged(
      "write_containment",
      "contradictory",
      "approved writable surfaces (arm HOME/tmpfs) did not accept writes",
    );
  }
  if (record?.["home_accessible_writable"] !== true) {
    return judged("write_containment", "missing", "arm HOME writability fact absent");
  }
  return judged(
    "write_containment",
    "demonstrated",
    "only arm HOME and tmpfs accepted writes; root and read-only mounts refused",
  );
}

function judgeNetworkDenial(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const record = probeRecord(facts, "network_denial");
  const results = asArray(record?.["results"]);
  if (results === null || results.length === 0) {
    return judged("network_denial", "missing", "network probe facts absent");
  }
  let sawTimeout = false;
  for (const entry of results) {
    const parsed = asRecord(entry) as NetworkResult | null;
    if (parsed === null) {
      return judged("network_denial", "missing", "network probe result malformed");
    }
    if (parsed.outcome === "connected") {
      return judged(
        "network_denial",
        "contradictory",
        `connection to ${parsed.target ?? "?"} succeeded`,
      );
    }
    if (parsed.outcome === "timeout") {
      sawTimeout = true;
      continue;
    }
    if (
      parsed.outcome !== "refused" ||
      typeof parsed.error_code !== "string" ||
      !IMMEDIATE_UNREACHABLE_CODES.has(parsed.error_code)
    ) {
      return judged(
        "network_denial",
        "ambiguous",
        `connection to ${parsed.target ?? "?"} failed with ${parsed.error_code ?? "unknown"}`,
      );
    }
  }
  if (sawTimeout) {
    return judged(
      "network_denial",
      "ambiguous",
      "at least one connection attempt timed out silently",
    );
  }
  return judged(
    "network_denial",
    "demonstrated",
    "every egress attempt failed immediately at the network layer",
  );
}

function judgeCredentialsAbsent(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const record = probeRecord(facts, "credentials_absent");
  const environment = asArray(record?.["environment"]);
  const paths = asArray(record?.["paths"]);
  if (environment === null || paths === null) {
    return judged("credentials_absent", "missing", "credential probe facts absent");
  }
  for (const entry of environment) {
    const parsed = asRecord(entry);
    if (parsed?.["present"] === true) {
      return judged(
        "credentials_absent",
        "contradictory",
        `credential-bearing environment name present: ${parsed["name"] ?? "?"}`,
      );
    }
  }
  for (const entry of paths) {
    const parsed = asRecord(entry);
    if (parsed?.["present"] === true) {
      return judged(
        "credentials_absent",
        "contradictory",
        `credential-bearing path present: ${parsed["name"] ?? "?"}`,
      );
    }
  }
  return judged(
    "credentials_absent",
    "demonstrated",
    "no credential environment names or paths present",
  );
}

function judgeResourceLimits(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const record = probeRecord(facts, "resource_limits");
  const cgroup = asRecord(record?.["cgroup"]);
  if (cgroup === null) {
    return judged("resource_limits", "missing", "resource limit probe facts absent");
  }
  const memory = asRecord(cgroup["memory_max"]);
  const pids = asRecord(cgroup["pids_max"]);
  const cpu = asRecord(cgroup["cpu_max"]);
  if (
    memory?.["state"] !== "observed" ||
    pids?.["state"] !== "observed" ||
    cpu?.["state"] !== "observed"
  ) {
    return judged("resource_limits", "missing", "cgroup limit files not observed");
  }
  const trimmedCgroupText = (
    record: Record<string, unknown> | null,
    key: string,
  ): string | null => {
    const value = record?.[key];
    return typeof value === "string" ? value.trim() : null;
  };
  const memoryText = trimmedCgroupText(memory, "text");
  const pidsText = trimmedCgroupText(pids, "text");
  const cpuText = trimmedCgroupText(cpu, "text") ?? "";
  if (memoryText !== "536870912") {
    return judged("resource_limits", "contradictory", `cgroup memory.max=${memoryText ?? "?"}`);
  }
  if (pidsText !== "64") {
    return judged("resource_limits", "contradictory", `cgroup pids.max=${pidsText ?? "?"}`);
  }
  const match = /^(\d+|-1)\s+(\d+)$/u.exec(cpuText);
  if (match === null) {
    return judged("resource_limits", "missing", `cgroup cpu.max unparseable: ${cpuText}`);
  }
  const quota = Number(match[1]);
  const period = Number(match[2]);
  if (quota !== 100000 || period !== 100000) {
    return judged("resource_limits", "contradictory", `cgroup cpu.max=${cpuText}`);
  }
  return judged(
    "resource_limits",
    "demonstrated",
    "memory.max=536870912, pids.max=64, cpu.max=100000/100000",
  );
}

function judgeDetachedDestroy(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const spawner = asRecord(
    facts.detached_destroy.spawner.state === "collected"
      ? facts.detached_destroy.spawner.parsed
      : null,
  );
  if (spawner?.["spawned"] !== true) {
    return judged("detached_destroy", "missing", "detached child was not spawned for the test");
  }
  const count = facts.detached_destroy.post_destroy_sleep_process_count;
  if (count === null) {
    return judged("detached_destroy", "missing", "post-destroy process count fact absent");
  }
  if (count !== "0") {
    return judged(
      "detached_destroy",
      "contradictory",
      `${count} detached descendants survived arm destruction`,
    );
  }
  const leftover = facts.detached_destroy.container_leftover_json;
  if (leftover === null) {
    return judged("detached_destroy", "missing", "container leftover fact absent");
  }
  try {
    const parsed = JSON.parse(leftover) as unknown;
    if (Array.isArray(parsed) && parsed.length === 0) {
      return judged(
        "detached_destroy",
        "demonstrated",
        "arm container removed; no detached descendant survived",
      );
    }
  } catch {
    return judged("detached_destroy", "missing", "container leftover fact unparseable");
  }
  return judged(
    "detached_destroy",
    "contradictory",
    "arm container or descendants survived destruction",
  );
}

function judgeCrossArmFreshness(facts: BackendQualificationFactsV1): QualificationControlJudgment {
  const writer = asRecord(
    facts.cross_arm_freshness.writer.state === "collected"
      ? facts.cross_arm_freshness.writer.parsed
      : null,
  );
  const checker = asRecord(
    facts.cross_arm_freshness.checker.state === "collected"
      ? facts.cross_arm_freshness.checker.parsed
      : null,
  );
  if (writer?.["planted"] !== true) {
    return judged("cross_arm_freshness", "missing", "freshness marker was not planted");
  }
  const entryCount = checker?.["entry_count"];
  if (typeof entryCount !== "number") {
    return judged("cross_arm_freshness", "missing", "next-arm HOME inventory absent");
  }
  if (entryCount !== 0) {
    return judged(
      "cross_arm_freshness",
      "contradictory",
      `next arm observed ${entryCount} pre-existing writable entries`,
    );
  }
  return judged(
    "cross_arm_freshness",
    "demonstrated",
    "marker planted in one arm was invisible to the next fresh arm",
  );
}

export function judgeBackendQualification(
  facts: BackendQualificationFactsV1,
  options: Readonly<{ armUserUid: string; armUserGid: string }> = {
    armUserUid: "10001",
    armUserGid: "10001",
  },
): QualificationJudgment {
  const controls = [
    judgeVmUserNonRoot(facts),
    judgeEngineRootless(facts),
    judgeImageIdentity(facts),
    judgeArmPrivilegeFloor(facts, options.armUserUid, options.armUserGid),
    judgeRootfsReadOnly(facts),
    judgeWriteContainment(facts),
    judgeNetworkDenial(facts),
    judgeCredentialsAbsent(facts),
    judgeResourceLimits(facts),
    judgeDetachedDestroy(facts),
    judgeCrossArmFreshness(facts),
  ];
  const blocking = controls
    .filter((control) => control.status !== "demonstrated")
    .map((control) => `${control.id}:${control.status}`);
  return Object.freeze({
    schema_version: "runparity.backend-qualification-judgment/v1",
    policy_version: 1,
    controls: Object.freeze(controls),
    overall: blocking.length === 0 ? "qualified" : "unqualified",
    blocking: Object.freeze(blocking),
  });
}
