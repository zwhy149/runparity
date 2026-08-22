import { snapshotExactDataRecord } from "../inert-snapshot.js";
import type {
  IdMapEntry,
  LinuxIds,
  LinuxRootlessPrivilegeFactsV1,
  ProbeFact,
} from "./linux-rootless-privilege-policy.js";

const BUNDLE_SCHEMA = "runparity.linux_rootless_privilege_probe_bundle/v1";
const FACTS_SCHEMA = "runparity.linux_rootless_privilege_facts/v1";
const UINT32_MAX = 0xffff_ffff;

export type LinuxRootlessPrivilegeProbeArtifactV1 =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "observed"; text: string }>;

export type LinuxRootlessPrivilegeProbeBundleV1 = Readonly<{
  schema: "runparity.linux_rootless_privilege_probe_bundle/v1";
  captureView: "guest_probe_process_self";
  platform: LinuxRootlessPrivilegeProbeArtifactV1;
  procSelfStatus: LinuxRootlessPrivilegeProbeArtifactV1;
  procSelfUidMap: LinuxRootlessPrivilegeProbeArtifactV1;
  procSelfGidMap: LinuxRootlessPrivilegeProbeArtifactV1;
  overflowUid: LinuxRootlessPrivilegeProbeArtifactV1;
  overflowGid: LinuxRootlessPrivilegeProbeArtifactV1;
}>;

type RawArtifact = LinuxRootlessPrivilegeProbeArtifactV1;

export type LinuxRootlessPrivilegeProbeBundleDecodeResult =
  | Readonly<{
      kind: "invalid_bundle";
      issue: "malformed_or_active_input" | "malformed_artifact";
    }>
  | Readonly<{
      kind: "decoded_unqualified_facts";
      sourceAssurance: "caller_supplied_unverified";
      facts: LinuxRootlessPrivilegeFactsV1;
    }>;

type TextPolicy = Readonly<{
  maximumBytes: number;
  maximumLines: number;
  maximumLineBytes: number;
}>;

type GuestPlatform = Readonly<{ os: string; architecture: string }>;
type ProcessIdentity = Readonly<{
  uids: LinuxIds;
  gids: LinuxIds;
  supplementaryGids: readonly number[];
}>;
type CapabilitySets = Readonly<{
  effective: string;
  permitted: string;
  inheritable: string;
  ambient: string;
  bounding: string;
}>;
type OverflowIds = Readonly<{ uid: number; gid: number }>;
type UserNamespaceMaps = Readonly<{
  view: "target_self_parent";
  uid: readonly IdMapEntry[];
  gid: readonly IdMapEntry[];
}>;

type ParsedStatus = Readonly<{
  processIdentity: ProbeFact<ProcessIdentity>;
  capabilitySets: ProbeFact<CapabilitySets>;
  noNewPrivileges: LinuxRootlessPrivilegeFactsV1["noNewPrivileges"];
}>;

const INVALID_INPUT: LinuxRootlessPrivilegeProbeBundleDecodeResult = Object.freeze({
  kind: "invalid_bundle",
  issue: "malformed_or_active_input",
});

const INVALID_ARTIFACT: LinuxRootlessPrivilegeProbeBundleDecodeResult = Object.freeze({
  kind: "invalid_bundle",
  issue: "malformed_artifact",
});

function missingFact<T>(): ProbeFact<T> {
  return Object.freeze({ state: "missing" });
}

function observedFact<T>(value: T): ProbeFact<T> {
  return Object.freeze({ state: "observed", value });
}

function snapshotArtifact(candidate: unknown): RawArtifact | null {
  const missing = snapshotExactDataRecord(candidate, ["state"]);
  if (missing?.["state"] === "missing") return Object.freeze({ state: "missing" });

  const observed = snapshotExactDataRecord(candidate, ["state", "text"]);
  if (observed?.["state"] !== "observed" || typeof observed["text"] !== "string") return null;
  return Object.freeze({ state: "observed", text: observed["text"] });
}

function boundedAsciiLines(text: string, policy: TextPolicy): readonly string[] | null {
  if (
    text.length === 0 ||
    text.length > policy.maximumBytes ||
    !text.endsWith("\n") ||
    Buffer.byteLength(text) > policy.maximumBytes ||
    !/^[\t\n\x20-\x7e]+$/u.test(text)
  ) {
    return null;
  }

  const body = text.slice(0, -1);
  if (body.length === 0) return null;
  const lines = body.split("\n");
  if (
    lines.length > policy.maximumLines ||
    lines.some(
      (line) =>
        line.length === 0 ||
        line.length > policy.maximumLineBytes ||
        Buffer.byteLength(line) > policy.maximumLineBytes,
    )
  ) {
    return null;
  }
  return Object.freeze(lines);
}

function parseCanonicalDecimal(value: string, allowReserved = false): number | null {
  if (!/^(?:0|[1-9][0-9]{0,9})$/u.test(value)) return null;
  const parsedInteger = BigInt(value);
  if (parsedInteger > BigInt(UINT32_MAX)) return null;
  const parsed = Number(parsedInteger);
  if (!allowReserved && parsed === UINT32_MAX) return null;
  return parsed;
}

function splitFields(value: string): readonly string[] {
  const trimmed = value.replace(/^[ \t]+|[ \t]+$/gu, "");
  return trimmed.length === 0 ? Object.freeze([]) : Object.freeze(trimmed.split(/[ \t]+/u));
}

function parseIdTuple(value: string): LinuxIds | null {
  const fields = splitFields(value);
  if (fields.length !== 4) return null;
  const parsed = fields.map((field) => parseCanonicalDecimal(field));
  if (parsed.some((item) => item === null)) return null;
  return Object.freeze({
    real: parsed[0] as number,
    effective: parsed[1] as number,
    saved: parsed[2] as number,
    filesystem: parsed[3] as number,
  });
}

function parseGroups(value: string): readonly number[] | null {
  const fields = splitFields(value);
  if (fields.length > 256) return null;
  const parsed = fields.map((field) => parseCanonicalDecimal(field));
  if (parsed.some((item) => item === null)) return null;
  const groups = parsed as number[];
  if (new Set(groups).size !== groups.length) return null;
  return Object.freeze(groups);
}

function parseCapabilityMask(value: string): string | null {
  const fields = splitFields(value);
  if (fields.length !== 1 || !/^[0-9a-f]{16}$/u.test(fields[0] as string)) return null;
  return BigInt(`0x${fields[0] as string}`).toString(16);
}

function parseNoNewPrivileges(value: string): 0 | 1 | null {
  const fields = splitFields(value);
  if (fields.length !== 1) return null;
  if (fields[0] === "0") return 0;
  if (fields[0] === "1") return 1;
  return null;
}

function parseStatus(text: string): ParsedStatus | null {
  const lines = boundedAsciiLines(text, {
    maximumBytes: 64 * 1024,
    maximumLines: 512,
    maximumLineBytes: 4 * 1024,
  });
  if (lines === null) return null;

  const relevant = new Set([
    "Uid",
    "Gid",
    "Groups",
    "CapInh",
    "CapPrm",
    "CapEff",
    "CapBnd",
    "CapAmb",
    "NoNewPrivs",
  ]);
  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    if (!relevant.has(key)) continue;
    if (values.has(key)) return null;
    values.set(key, line.slice(separator + 1));
  }

  const parsedUids = values.has("Uid") ? parseIdTuple(values.get("Uid") as string) : undefined;
  const parsedGids = values.has("Gid") ? parseIdTuple(values.get("Gid") as string) : undefined;
  const parsedGroups = values.has("Groups")
    ? parseGroups(values.get("Groups") as string)
    : undefined;
  if (parsedUids === null || parsedGids === null || parsedGroups === null) return null;

  const processIdentity: ParsedStatus["processIdentity"] =
    parsedUids === undefined || parsedGids === undefined || parsedGroups === undefined
      ? missingFact<ProcessIdentity>()
      : observedFact(
          Object.freeze({
            uids: parsedUids,
            gids: parsedGids,
            supplementaryGids: parsedGroups,
          }),
        );

  const capabilityKeys = ["CapEff", "CapPrm", "CapInh", "CapAmb", "CapBnd"] as const;
  const masks = capabilityKeys.map((key) =>
    values.has(key) ? parseCapabilityMask(values.get(key) as string) : undefined,
  );
  if (masks.some((mask) => mask === null)) return null;
  const capabilitySets: ParsedStatus["capabilitySets"] = masks.some((mask) => mask === undefined)
    ? missingFact<CapabilitySets>()
    : observedFact(
        Object.freeze({
          effective: masks[0] as string,
          permitted: masks[1] as string,
          inheritable: masks[2] as string,
          ambient: masks[3] as string,
          bounding: masks[4] as string,
        }),
      );

  const noNewPrivilegesValue = values.has("NoNewPrivs")
    ? parseNoNewPrivileges(values.get("NoNewPrivs") as string)
    : undefined;
  if (noNewPrivilegesValue === null) return null;
  const noNewPrivileges: ParsedStatus["noNewPrivileges"] =
    noNewPrivilegesValue === undefined ? missingFact<0 | 1>() : observedFact(noNewPrivilegesValue);

  return Object.freeze({ processIdentity, capabilitySets, noNewPrivileges });
}

function parsePlatform(text: string): Readonly<{ os: string; architecture: string }> | null {
  const lines = boundedAsciiLines(text, {
    maximumBytes: 128,
    maximumLines: 2,
    maximumLineBytes: 64,
  });
  if (lines === null || lines.length !== 2) return null;
  const osMatch = /^os=([a-z0-9][a-z0-9_.-]{0,31})$/u.exec(lines[0] as string);
  const architectureMatch = /^architecture=([a-z0-9][a-z0-9_.-]{0,31})$/u.exec(lines[1] as string);
  if (osMatch?.[1] === undefined || architectureMatch?.[1] === undefined) return null;
  return Object.freeze({ os: osMatch[1], architecture: architectureMatch[1] });
}

function rangesOverlap(
  leftStart: number,
  leftLength: number,
  rightStart: number,
  rightLength: number,
): boolean {
  return leftStart < rightStart + rightLength && rightStart < leftStart + leftLength;
}

function mapsAreNonOverlapping(entries: readonly IdMapEntry[]): boolean {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const leftEntry = entries[left];
      const rightEntry = entries[right];
      if (
        leftEntry === undefined ||
        rightEntry === undefined ||
        rangesOverlap(
          leftEntry.insideStart,
          leftEntry.length,
          rightEntry.insideStart,
          rightEntry.length,
        ) ||
        rangesOverlap(
          leftEntry.outsideStart,
          leftEntry.length,
          rightEntry.outsideStart,
          rightEntry.length,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function parseIdMap(text: string): readonly IdMapEntry[] | null {
  if (text.length === 0) return Object.freeze([]);
  const lines = boundedAsciiLines(text, {
    maximumBytes: 8 * 1024,
    maximumLines: 64,
    maximumLineBytes: 256,
  });
  if (lines === null) return null;

  const entries: IdMapEntry[] = [];
  for (const line of lines) {
    const fields = splitFields(line);
    if (fields.length !== 3) return null;
    const insideStart = parseCanonicalDecimal(fields[0] as string);
    const outsideStart = parseCanonicalDecimal(fields[1] as string);
    const length = parseCanonicalDecimal(fields[2] as string, true);
    if (
      insideStart === null ||
      outsideStart === null ||
      length === null ||
      length === 0 ||
      insideStart + length > UINT32_MAX ||
      outsideStart + length > UINT32_MAX
    ) {
      return null;
    }
    entries.push(Object.freeze({ insideStart, outsideStart, length }));
  }
  if (!mapsAreNonOverlapping(entries)) return null;
  return Object.freeze(entries);
}

function parseOverflowId(text: string): number | null {
  const lines = boundedAsciiLines(text, {
    maximumBytes: 32,
    maximumLines: 1,
    maximumLineBytes: 31,
  });
  if (lines === null || lines.length !== 1) return null;
  return parseCanonicalDecimal(lines[0] as string);
}

function parseObserved<T>(artifact: RawArtifact, parser: (text: string) => T | null): T | null {
  return artifact.state === "observed" ? parser(artifact.text) : null;
}

/**
 * Decodes caller-supplied raw guest strings into unqualified facts. The fixed
 * capture view is a protocol claim only; this function cannot authenticate the
 * collector, process, namespace, session, or source files.
 *
 * @internal
 */
export function decodeLinuxRootlessPrivilegeProbeBundle(
  candidate: unknown,
): LinuxRootlessPrivilegeProbeBundleDecodeResult {
  const bundle = snapshotExactDataRecord(candidate, [
    "schema",
    "captureView",
    "platform",
    "procSelfStatus",
    "procSelfUidMap",
    "procSelfGidMap",
    "overflowUid",
    "overflowGid",
  ]);
  if (
    bundle?.["schema"] !== BUNDLE_SCHEMA ||
    bundle["captureView"] !== "guest_probe_process_self"
  ) {
    return INVALID_INPUT;
  }

  const platformArtifact = snapshotArtifact(bundle["platform"]);
  const statusArtifact = snapshotArtifact(bundle["procSelfStatus"]);
  const uidMapArtifact = snapshotArtifact(bundle["procSelfUidMap"]);
  const gidMapArtifact = snapshotArtifact(bundle["procSelfGidMap"]);
  const overflowUidArtifact = snapshotArtifact(bundle["overflowUid"]);
  const overflowGidArtifact = snapshotArtifact(bundle["overflowGid"]);
  if (
    platformArtifact === null ||
    statusArtifact === null ||
    uidMapArtifact === null ||
    gidMapArtifact === null ||
    overflowUidArtifact === null ||
    overflowGidArtifact === null
  ) {
    return INVALID_INPUT;
  }

  const platform = parseObserved(platformArtifact, parsePlatform);
  const status = parseObserved(statusArtifact, parseStatus);
  const uidMap = parseObserved(uidMapArtifact, parseIdMap);
  const gidMap = parseObserved(gidMapArtifact, parseIdMap);
  const overflowUid = parseObserved(overflowUidArtifact, parseOverflowId);
  const overflowGid = parseObserved(overflowGidArtifact, parseOverflowId);
  if (
    (platformArtifact.state === "observed" && platform === null) ||
    (statusArtifact.state === "observed" && status === null) ||
    (uidMapArtifact.state === "observed" && uidMap === null) ||
    (gidMapArtifact.state === "observed" && gidMap === null) ||
    (overflowUidArtifact.state === "observed" && overflowUid === null) ||
    (overflowGidArtifact.state === "observed" && overflowGid === null)
  ) {
    return INVALID_ARTIFACT;
  }

  const guestPlatform: LinuxRootlessPrivilegeFactsV1["guestPlatform"] =
    platformArtifact.state === "missing"
      ? missingFact<GuestPlatform>()
      : observedFact(platform as GuestPlatform);
  const processIdentity: LinuxRootlessPrivilegeFactsV1["processIdentity"] =
    statusArtifact.state === "missing"
      ? missingFact<ProcessIdentity>()
      : (status as ParsedStatus).processIdentity;
  const overflowIds: LinuxRootlessPrivilegeFactsV1["overflowIds"] =
    overflowUidArtifact.state === "missing" || overflowGidArtifact.state === "missing"
      ? missingFact<OverflowIds>()
      : observedFact(Object.freeze({ uid: overflowUid as number, gid: overflowGid as number }));
  const userNamespaceMaps: LinuxRootlessPrivilegeFactsV1["userNamespaceMaps"] =
    uidMapArtifact.state === "missing" || gidMapArtifact.state === "missing"
      ? missingFact<UserNamespaceMaps>()
      : observedFact(
          Object.freeze({
            view: "target_self_parent" as const,
            uid: uidMap as readonly IdMapEntry[],
            gid: gidMap as readonly IdMapEntry[],
          }),
        );
  const capabilitySets: LinuxRootlessPrivilegeFactsV1["capabilitySets"] =
    statusArtifact.state === "missing"
      ? missingFact<CapabilitySets>()
      : (status as ParsedStatus).capabilitySets;
  const noNewPrivileges: LinuxRootlessPrivilegeFactsV1["noNewPrivileges"] =
    statusArtifact.state === "missing"
      ? missingFact<0 | 1>()
      : (status as ParsedStatus).noNewPrivileges;

  const facts: LinuxRootlessPrivilegeFactsV1 = Object.freeze({
    schema: FACTS_SCHEMA,
    guestPlatform,
    processIdentity,
    overflowIds,
    userNamespaceMaps,
    capabilitySets,
    noNewPrivileges,
  });

  return Object.freeze({
    kind: "decoded_unqualified_facts",
    sourceAssurance: "caller_supplied_unverified",
    facts,
  });
}
