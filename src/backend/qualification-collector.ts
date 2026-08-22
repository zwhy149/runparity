import { classifyLinuxRootlessPrivilegeFacts } from "../oci/linux-rootless-privilege-policy.js";
import { decodeLinuxRootlessPrivilegeProbeBundle } from "../oci/linux-rootless-privilege-probe-bundle.js";
import { ARM_ISOLATION_POLICY_V1, buildArmRunArgv } from "./arm-isolation-policy.js";
import { canonicalSha256Hex } from "./digest.js";
import type { BackendTransport, BackendTransportCompletion } from "./ssh-backend-transport.js";

/**
 * Backend qualification fact collector.
 *
 * Collects bounded raw facts through the backend transport. It classifies
 * nothing and authorizes nothing: every demonstrated/missing/contradictory
 * judgment lives in the pure qualification policy, and only the receipt
 * verifier may bind facts to a qualification receipt.
 */

export type QualificationProbeConfig = Readonly<{
  imageDigestRef: string;
  imageAcquisitionMirror: string;
  vmUserUid: number;
  vmUserGid: number;
  probeHostDir: string;
  armsHostRoot: string;
  totalDeadlineNanoseconds: bigint;
  nowNanoseconds: () => bigint;
}>;

type ProbeOutput = Readonly<{
  state: "collected" | "missing";
  exit_code: number | null;
  stdout_sha256: string | null;
  parsed: unknown;
  note: string | null;
}>;

export type ParentBindingFacts = Readonly<{
  ran_detached: boolean;
  container_pid: string | null;
  host_status_text: string | null;
  host_uid_map_text: string | null;
  post_destroy_sleep_count: string | null;
}>;

function extractBindPid(inspectJson: unknown): string | null {
  if (!Array.isArray(inspectJson) || inspectJson.length !== 1) {
    return null;
  }
  const entry = inspectJson[0];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const state = (entry as Record<string, unknown>)["State"];
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  const pid = (state as Record<string, unknown>)["Pid"];
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? String(pid) : null;
}

export type BackendQualificationFactsV1 = Readonly<{
  schema_version: "runparity.backend-qualification-facts/v1";
  collector_version: 1;
  arm_isolation_policy_digest: string;
  image_digest_ref: string;
  image_acquisition_mirror: string;
  vm_identity: Readonly<{
    user_uid: string;
    user_gid: string;
    kernel: string;
    os_release_pretty: string;
  }>;
  engine: Readonly<{
    version: string;
    api_version: string;
    rootless: boolean | null;
    cgroup_version: string | null;
    cgroup_controllers: readonly string[] | null;
    id_mappings_uid: readonly string[] | null;
    id_mappings_gid: readonly string[] | null;
    conmon_path: string | null;
  }>;
  image: Readonly<{
    image_id: string | null;
    os: string | null;
    architecture: string | null;
    repo_digests: readonly string[] | null;
  }>;
  privilege_probe: Readonly<{
    probe: ProbeOutput;
    bundle_decoded: boolean;
    facts: unknown;
    classification: unknown;
  }>;
  parent_binding: ParentBindingFacts;
  readonly_write: ProbeOutput;
  network_denial: ProbeOutput;
  credentials_absent: ProbeOutput;
  resource_limits: ProbeOutput;
  detached_destroy: Readonly<{
    spawner: ProbeOutput;
    post_destroy_sleep_process_count: string | null;
    container_leftover_json: string | null;
  }>;
  cross_arm_freshness: Readonly<{
    writer: ProbeOutput;
    checker: ProbeOutput;
  }>;
  command_audit: readonly QualificationCommandAuditEntry[];
}>;

export type QualificationCommandAuditEntry = Readonly<{
  purpose: string;
  args_digest: string;
  outcome: "completed" | "refused";
  exit_code: number | null;
  duration_ms: number | null;
}>;

const ARM_COMMAND_BUDGET_NANOSECONDS = 120n * 1000n * 1000n * 1000n;
const SIMPLE_COMMAND_BUDGET_NANOSECONDS = 20n * 1000n * 1000n * 1000n;

export class QualificationCollectionError extends Error {
  public readonly reasonCode = "RP_BACKEND_QUALIFICATION_COLLECTION_FAILED";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asStringArray(value: unknown): readonly string[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as readonly string[];
  }
  return null;
}

function asIdMappingStrings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      entries.push(entry);
      continue;
    }
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const containerId =
        record["container_id"] ?? record["containerID"] ?? record["container_uid"];
      const hostId = record["host_id"] ?? record["hostID"] ?? record["host_uid"];
      const length = record["length"] ?? record["size"];
      if (
        typeof containerId === "number" &&
        typeof hostId === "number" &&
        typeof length === "number"
      ) {
        entries.push(`${containerId}:${hostId}:${length}`);
      }
    }
  }
  return entries.length > 0 ? entries : null;
}

function missingProbe(note: string): ProbeOutput {
  return Object.freeze({
    state: "missing",
    exit_code: null,
    stdout_sha256: null,
    parsed: null,
    note,
  });
}

export async function collectBackendQualificationFacts(
  transport: BackendTransport,
  config: QualificationProbeConfig,
): Promise<BackendQualificationFactsV1> {
  const audit: {
    purpose: string;
    args_digest: string;
    outcome: "completed" | "refused";
    exit_code: number | null;
    duration_ms: number | null;
  }[] = [];
  const remaining = () => config.totalDeadlineNanoseconds - config.nowNanoseconds();

  const runCommand = async (
    purpose: string,
    args: readonly string[],
    isArm: boolean,
  ): Promise<BackendTransportCompletion> => {
    const budget = isArm ? ARM_COMMAND_BUDGET_NANOSECONDS : SIMPLE_COMMAND_BUDGET_NANOSECONDS;
    const left = remaining();
    if (left <= 0n) {
      throw new QualificationCollectionError(`deadline exhausted before ${purpose}`);
    }
    const deadline = config.nowNanoseconds() + (left < budget ? left : budget);
    const completion = await transport.run({ args, deadlineNanoseconds: deadline });
    audit.push({
      purpose,
      args_digest: canonicalSha256Hex(args),
      outcome: completion.kind,
      exit_code: completion.kind === "completed" ? completion.exitCode : null,
      duration_ms: completion.kind === "completed" ? completion.durationMs : null,
    });
    return completion;
  };

  const completedText = (
    completion: BackendTransportCompletion,
  ): { text: string; exitCode: number } | null =>
    completion.kind === "completed"
      ? { text: completion.stdout, exitCode: completion.exitCode }
      : null;

  const parseJsonOutput = (completion: BackendTransportCompletion): ProbeOutput => {
    const raw = completedText(completion);
    if (raw === null) {
      return missingProbe("transport_refused");
    }
    const trimmed = raw.text.trim();
    if (trimmed.length === 0) {
      return missingProbe(`empty stdout; exit=${raw.exitCode}`);
    }
    try {
      return Object.freeze({
        state: "collected" as const,
        exit_code: raw.exitCode,
        stdout_sha256: canonicalSha256Hex(raw.text),
        parsed: JSON.parse(trimmed) as unknown,
        note: null,
      });
    } catch {
      return missingProbe(`unparseable stdout; exit=${raw.exitCode}`);
    }
  };

  const probeEnv = Object.freeze({
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/home/arm",
  });

  const runProbeArm = async (
    armName: string,
    probeScript: string,
    scriptArgs: readonly string[] = [],
  ): Promise<BackendTransportCompletion> => {
    const armsRoot = config.armsHostRoot.replace(/\/+$/u, "");
    const homeDir = `${armsRoot}/${armName}`;
    await runCommand(`fresh_home:${armName}`, ["rm", "-rf", homeDir], false);
    await runCommand(`mkdir_home:${armName}`, ["mkdir", "-p", homeDir], false);
    const argv = buildArmRunArgv({
      armName,
      imageDigestRef: config.imageDigestRef,
      environment: probeEnv,
      assetHostDir: config.probeHostDir,
      armHomeHostDir: homeDir,
      workingDirectory: "/arm/assets",
      timeoutSeconds: ARM_ISOLATION_POLICY_V1.podman_timeout_seconds,
      targetArgv: ["node", `/arm/assets/${probeScript}`, ...scriptArgs],
      mode: "run",
    });
    return runCommand(`probe:${armName}`, argv, true);
  };

  const collectParentBinding = async (): Promise<ParentBindingFacts> => {
    const armsRoot = config.armsHostRoot.replace(/\/+$/u, "");
    const bindName = "rp-qual-bind";
    const homeDir = `${armsRoot}/${bindName}`;
    await runCommand("bind_cleanup_before", ["podman", "rm", "-f", "-t", "1", bindName], false);
    await runCommand(`fresh_home:${bindName}`, ["rm", "-rf", homeDir], false);
    await runCommand(`mkdir_home:${bindName}`, ["mkdir", "-p", homeDir], false);
    const bindRunCompletion = await runCommand(
      "bind_run",
      buildArmRunArgv({
        armName: bindName,
        imageDigestRef: config.imageDigestRef,
        environment: probeEnv,
        assetHostDir: config.probeHostDir,
        armHomeHostDir: homeDir,
        workingDirectory: "/arm/assets",
        timeoutSeconds: 60,
        targetArgv: ["sleep", "45"],
        mode: "bind",
      }),
      true,
    );
    const bindRunRaw = completedText(bindRunCompletion);
    // `podman run -d` prints the bare 64-hex container id, never JSON.
    const ranDetached =
      bindRunRaw !== null &&
      bindRunRaw.exitCode === 0 &&
      /^[0-9a-f]{64}\s*$/u.test(bindRunRaw.text.trim());
    const bindOutput = parseJsonOutput(
      await runCommand("bind_inspect", ["podman", "inspect", "--format", "json", bindName], false),
    );
    const containerPid = extractBindPid(bindOutput.parsed);
    let statusText: string | null = null;
    let uidMapText: string | null = null;
    if (containerPid !== null) {
      const status = completedText(
        await runCommand("bind_status", ["cat", `/proc/${containerPid}/status`], false),
      );
      const uidMap = completedText(
        await runCommand("bind_uid_map", ["cat", `/proc/${containerPid}/uid_map`], false),
      );
      if (status !== null && status.exitCode === 0) {
        statusText = status.text;
      }
      if (uidMap !== null && uidMap.exitCode === 0) {
        uidMapText = uidMap.text;
      }
    }
    await runCommand("bind_cleanup_after", ["podman", "rm", "-f", "-t", "1", bindName], false);
    const sleepAfterBind = completedText(
      await runCommand(
        "bind_post_destroy_sleep_count",
        ["pgrep", "-c", "-u", String(config.vmUserUid), "-x", "sleep"],
        false,
      ),
    );
    return {
      container_pid: containerPid,
      ran_detached: ranDetached,
      host_status_text: statusText,
      host_uid_map_text: uidMapText,
      post_destroy_sleep_count:
        sleepAfterBind !== null && /^\d+$/u.test(sleepAfterBind.text.trim())
          ? sleepAfterBind.text.trim()
          : null,
    };
  };

  const requireText = async (purpose: string, args: readonly string[]): Promise<string> => {
    const completion = await runCommand(purpose, args, false);
    const raw = completedText(completion);
    if (raw === null || raw.exitCode !== 0) {
      throw new QualificationCollectionError(`command failed: ${purpose}`);
    }
    return raw.text.trim();
  };

  const vmUid = await requireText("vm_uid", ["id", "-u"]);
  const vmGid = await requireText("vm_gid", ["id", "-g"]);
  const kernel = await requireText("vm_kernel", ["uname", "-r"]);
  const osRelease = await requireText("vm_os_release", ["cat", "/etc/os-release"]);
  const prettyName = /^PRETTY_NAME=(.+)$/mu.exec(osRelease)?.[1]?.replaceAll('"', "") ?? "";

  const versionOutput = parseJsonOutput(
    await runCommand("podman_version", ["podman", "version", "--format", "json"], false),
  );
  const infoOutput = parseJsonOutput(
    await runCommand("podman_info", ["podman", "info", "--format", "json"], false),
  );
  const imageOutput = parseJsonOutput(
    await runCommand(
      "podman_image_inspect",
      ["podman", "image", "inspect", "--format", "json", config.imageDigestRef],
      false,
    ),
  );

  const clientRecord = asRecord(asRecord(versionOutput.parsed)?.["Client"]);
  const infoRecord = asRecord(infoOutput.parsed);
  const hostRecord = asRecord(infoRecord?.["host"]);
  const securityRecord = asRecord(hostRecord?.["security"]);
  const mappingsRecord = asRecord(hostRecord?.["idMappings"]);
  const imageList = Array.isArray(imageOutput.parsed) ? imageOutput.parsed : [];
  const imageRecord = asRecord(imageList[0]);

  const privilegeProbe = parseJsonOutput(
    await runProbeArm("rp-qual-pv", "linux-rootless-privilege-probe.js"),
  );
  const readonlyWrite = parseJsonOutput(
    await runProbeArm("rp-qual-ro", "readonly-write-probe.mjs"),
  );
  const networkDenial = parseJsonOutput(await runProbeArm("rp-qual-net", "network-probe.mjs"));
  const credentialsAbsent = parseJsonOutput(
    await runProbeArm("rp-qual-cred", "credential-probe.mjs"),
  );
  const resourceLimits = parseJsonOutput(await runProbeArm("rp-qual-lim", "limit-probe.mjs"));

  const detachedSpawner = parseJsonOutput(
    await runProbeArm("rp-qual-det", "detached-spawner-probe.mjs"),
  );
  const sleepCountCompletion = await runCommand(
    "post_destroy_sleep_count",
    ["pgrep", "-c", "-u", String(config.vmUserUid), "-x", "sleep"],
    false,
  );
  const leftoverCompletion = await runCommand(
    "container_leftover",
    ["podman", "ps", "-a", "--filter", "name=rp-qual-det", "--format", "json"],
    false,
  );
  const sleepCount = completedText(sleepCountCompletion);
  const leftoverJson = completedText(leftoverCompletion);
  const sleepCountText = sleepCount !== null ? sleepCount.text.trim() : null;
  const leftoverText = leftoverJson !== null ? leftoverJson.text.trim() : null;

  const residueWriter = parseJsonOutput(
    await runProbeArm("rp-qual-res-w", "residue-probe.mjs", ["--write"]),
  );
  const residueChecker = parseJsonOutput(
    await runProbeArm("rp-qual-res-c", "residue-probe.mjs", ["--check"]),
  );

  let privilegeFacts: unknown = null;
  let privilegeClassification: unknown = null;
  let bundleDecoded = false;
  if (privilegeProbe.state === "collected") {
    const decoded = decodeLinuxRootlessPrivilegeProbeBundle(privilegeProbe.parsed);
    if (decoded !== null && decoded.kind === "decoded_unqualified_facts") {
      privilegeFacts = decoded.facts;
      privilegeClassification = classifyLinuxRootlessPrivilegeFacts(privilegeFacts);
      bundleDecoded = true;
    }
  }

  const parentBinding = await collectParentBinding();

  const controllers = asStringArray(hostRecord?.["cgroupControllers"]);

  return Object.freeze({
    schema_version: "runparity.backend-qualification-facts/v1",
    collector_version: 1,
    arm_isolation_policy_digest: canonicalSha256Hex(ARM_ISOLATION_POLICY_V1),
    image_digest_ref: config.imageDigestRef,
    image_acquisition_mirror: config.imageAcquisitionMirror,
    vm_identity: Object.freeze({
      user_uid: vmUid,
      user_gid: vmGid,
      kernel,
      os_release_pretty: prettyName,
    }),
    engine: Object.freeze({
      version: typeof clientRecord?.["Version"] === "string" ? clientRecord["Version"] : "",
      api_version:
        typeof clientRecord?.["APIVersion"] === "string" ? clientRecord["APIVersion"] : "",
      rootless:
        typeof securityRecord?.["rootless"] === "boolean" ? securityRecord["rootless"] : null,
      cgroup_version:
        typeof hostRecord?.["cgroupVersion"] === "string" ? hostRecord["cgroupVersion"] : null,
      cgroup_controllers: controllers,
      id_mappings_uid: asIdMappingStrings(mappingsRecord?.["uidMap"] ?? mappingsRecord?.["uidmap"]),
      id_mappings_gid: asIdMappingStrings(mappingsRecord?.["gidMap"] ?? mappingsRecord?.["gidmap"]),
      conmon_path: typeof hostRecord?.["conmonPath"] === "string" ? hostRecord["conmonPath"] : null,
    }),
    image: Object.freeze({
      image_id: typeof imageRecord?.["Id"] === "string" ? imageRecord["Id"] : null,
      os: typeof imageRecord?.["Os"] === "string" ? imageRecord["Os"] : null,
      architecture:
        typeof imageRecord?.["Architecture"] === "string" ? imageRecord["Architecture"] : null,
      repo_digests: asStringArray(imageRecord?.["RepoDigests"]),
    }),
    privilege_probe: Object.freeze({
      probe: privilegeProbe,
      bundle_decoded: bundleDecoded,
      facts: privilegeFacts,
      classification: privilegeClassification,
    }),
    parent_binding: Object.freeze(parentBinding),
    readonly_write: readonlyWrite,
    network_denial: networkDenial,
    credentials_absent: credentialsAbsent,
    resource_limits: resourceLimits,
    detached_destroy: Object.freeze({
      spawner: detachedSpawner,
      post_destroy_sleep_process_count:
        sleepCountText !== null && /^\d+$/u.test(sleepCountText) ? sleepCountText : null,
      container_leftover_json: leftoverText,
    }),
    cross_arm_freshness: Object.freeze({
      writer: residueWriter,
      checker: residueChecker,
    }),
    command_audit: Object.freeze(audit),
  });
}
