import { isProxy } from "node:util/types";
import { snapshotExactDataRecord } from "../inert-snapshot.js";

const SCHEMA = "runparity.linux_rootless_privilege_facts/v1";
const SCOPE = "linux_rootless_privilege_floor_v1";
const UINT32_MAX = 0xffff_ffff;
const MAX_MAP_ENTRIES = 64;
const MAX_SUPPLEMENTARY_GIDS = 256;

export type ProbeFact<T> =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "observed"; value: T }>;

export type LinuxIds = Readonly<{
  real: number;
  effective: number;
  saved: number;
  filesystem: number;
}>;

export type IdMapEntry = Readonly<{
  insideStart: number;
  outsideStart: number;
  length: number;
}>;

export type LinuxRootlessPrivilegeFactsV1 = Readonly<{
  schema: typeof SCHEMA;
  guestPlatform: ProbeFact<Readonly<{ os: string; architecture: string }>>;
  processIdentity: ProbeFact<
    Readonly<{
      uids: LinuxIds;
      gids: LinuxIds;
      supplementaryGids: readonly number[];
    }>
  >;
  overflowIds: ProbeFact<Readonly<{ uid: number; gid: number }>>;
  userNamespaceMaps: ProbeFact<
    Readonly<{
      view: "target_self_parent";
      uid: readonly IdMapEntry[];
      gid: readonly IdMapEntry[];
    }>
  >;
  capabilitySets: ProbeFact<
    Readonly<{
      effective: string;
      permitted: string;
      inheritable: string;
      ambient: string;
      bounding: string;
    }>
  >;
  noNewPrivileges: ProbeFact<0 | 1>;
}>;

export type PrivilegeFactId =
  | "guest_platform"
  | "process_identity"
  | "overflow_ids"
  | "user_namespace_maps"
  | "capability_sets"
  | "no_new_privileges";

export type PrivilegeContradiction =
  | "platform_not_linux_amd64"
  | "process_has_root_uid"
  | "process_has_root_gid"
  | "process_has_root_supplementary_gid"
  | "process_uid_not_mapped"
  | "process_gid_not_mapped"
  | "parent_root_uid_mapped"
  | "parent_root_gid_mapped"
  | "effective_capabilities_nonzero"
  | "permitted_capabilities_nonzero"
  | "inheritable_capabilities_nonzero"
  | "ambient_capabilities_nonzero"
  | "bounding_capabilities_nonzero"
  | "no_new_privileges_disabled";

export type PrivilegeAmbiguity =
  | "process_uid_matches_overflow_id"
  | "process_gid_matches_overflow_id";

export type LinuxRootlessPrivilegeClassification =
  | Readonly<{
      kind: "invalid_snapshot";
      issue: "malformed_or_active_input";
    }>
  | Readonly<{
      kind: "missing";
      missing: readonly PrivilegeFactId[];
    }>
  | Readonly<{
      kind: "contradictory";
      contradictions: readonly PrivilegeContradiction[];
      missing: readonly PrivilegeFactId[];
    }>
  | Readonly<{
      kind: "ambiguous";
      ambiguities: readonly PrivilegeAmbiguity[];
      missing: readonly PrivilegeFactId[];
    }>
  | Readonly<{
      kind: "no_contradiction_in_privilege_subset";
      scope: typeof SCOPE;
    }>;

type GuestPlatform = Readonly<{ os: string; architecture: string }>;
type ProcessIdentity = Readonly<{
  uids: LinuxIds;
  gids: LinuxIds;
  supplementaryGids: readonly number[];
}>;
type OverflowIds = Readonly<{ uid: number; gid: number }>;
type UserNamespaceMaps = Readonly<{
  view: "target_self_parent";
  uid: readonly IdMapEntry[];
  gid: readonly IdMapEntry[];
}>;
type CapabilitySets = Readonly<{
  effective: string;
  permitted: string;
  inheritable: string;
  ambient: string;
  bounding: string;
}>;
type Snapshot = Readonly<{
  guestPlatform: GuestPlatform | null;
  processIdentity: ProcessIdentity | null;
  overflowIds: OverflowIds | null;
  userNamespaceMaps: UserNamespaceMaps | null;
  capabilitySets: CapabilitySets | null;
  noNewPrivileges: 0 | 1 | null;
}>;

const INVALID_SNAPSHOT: LinuxRootlessPrivilegeClassification = Object.freeze({
  kind: "invalid_snapshot",
  issue: "malformed_or_active_input",
});

const NO_CONTRADICTION: LinuxRootlessPrivilegeClassification = Object.freeze({
  kind: "no_contradiction_in_privilege_subset",
  scope: SCOPE,
});

function snapshotArray<T>(
  value: unknown,
  maximumLength: number,
  snapshotItem: (item: unknown) => T | null,
): readonly T[] | null {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) {
    return null;
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = descriptors["length"];
  const length =
    lengthDescriptor !== undefined && Object.hasOwn(lengthDescriptor, "value")
      ? lengthDescriptor.value
      : null;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumLength ||
    keys.some((key) => typeof key !== "string") ||
    keys.length !== length + 1
  ) {
    return null;
  }
  const snapshot: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const indexKey = String(index);
    if (!Object.hasOwn(descriptors, indexKey)) return null;
    const descriptor = descriptors[indexKey];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      return null;
    }
    const item = snapshotItem(descriptor.value);
    if (item === null) return null;
    snapshot.push(item);
  }
  return Object.freeze(snapshot);
}

function isUint32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

function isMappableId(value: unknown): value is number {
  return isUint32(value) && value < UINT32_MAX;
}

function snapshotIds(value: unknown): LinuxIds | null {
  const record = snapshotExactDataRecord(value, ["real", "effective", "saved", "filesystem"]);
  const real = record?.["real"];
  const effective = record?.["effective"];
  const saved = record?.["saved"];
  const filesystem = record?.["filesystem"];
  if (![real, effective, saved, filesystem].every(isMappableId)) return null;
  return Object.freeze({
    real: real as number,
    effective: effective as number,
    saved: saved as number,
    filesystem: filesystem as number,
  });
}

function snapshotMapEntry(value: unknown): IdMapEntry | null {
  const record = snapshotExactDataRecord(value, ["insideStart", "outsideStart", "length"]);
  const insideStart = record?.["insideStart"];
  const outsideStart = record?.["outsideStart"];
  const length = record?.["length"];
  if (
    !isMappableId(insideStart) ||
    !isMappableId(outsideStart) ||
    !isUint32(length) ||
    length === 0
  ) {
    return null;
  }
  if (insideStart + length > UINT32_MAX || outsideStart + length > UINT32_MAX) return null;
  return Object.freeze({ insideStart, outsideStart, length });
}

function rangesOverlap(
  leftStart: number,
  leftLength: number,
  rightStart: number,
  rightLength: number,
): boolean {
  return leftStart < rightStart + rightLength && rightStart < leftStart + leftLength;
}

function validNonOverlappingMaps(entries: readonly IdMapEntry[]): boolean {
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

function snapshotGuestPlatform(value: unknown): GuestPlatform | null {
  const record = snapshotExactDataRecord(value, ["os", "architecture"]);
  const os = record?.["os"];
  const architecture = record?.["architecture"];
  const scalar = /^[a-z0-9][a-z0-9_.-]{0,31}$/u;
  if (typeof os !== "string" || typeof architecture !== "string") return null;
  if (!scalar.test(os) || !scalar.test(architecture)) return null;
  return Object.freeze({ os, architecture });
}

function snapshotProcessIdentity(value: unknown): ProcessIdentity | null {
  const record = snapshotExactDataRecord(value, ["uids", "gids", "supplementaryGids"]);
  const uids = snapshotIds(record?.["uids"]);
  const gids = snapshotIds(record?.["gids"]);
  const supplementaryGids = snapshotArray(
    record?.["supplementaryGids"],
    MAX_SUPPLEMENTARY_GIDS,
    (item) => (isMappableId(item) ? item : null),
  );
  if (uids === null || gids === null || supplementaryGids === null) return null;
  if (new Set(supplementaryGids).size !== supplementaryGids.length) return null;
  return Object.freeze({ uids, gids, supplementaryGids });
}

function snapshotOverflowIds(value: unknown): OverflowIds | null {
  const record = snapshotExactDataRecord(value, ["uid", "gid"]);
  const uid = record?.["uid"];
  const gid = record?.["gid"];
  if (!isMappableId(uid) || !isMappableId(gid)) return null;
  return Object.freeze({ uid, gid });
}

function snapshotUserNamespaceMaps(value: unknown): UserNamespaceMaps | null {
  const record = snapshotExactDataRecord(value, ["view", "uid", "gid"]);
  if (record?.["view"] !== "target_self_parent") return null;
  const uid = snapshotArray(record["uid"], MAX_MAP_ENTRIES, snapshotMapEntry);
  const gid = snapshotArray(record["gid"], MAX_MAP_ENTRIES, snapshotMapEntry);
  if (
    uid === null ||
    gid === null ||
    !validNonOverlappingMaps(uid) ||
    !validNonOverlappingMaps(gid)
  ) {
    return null;
  }
  return Object.freeze({ view: "target_self_parent", uid, gid });
}

function snapshotCapabilitySets(value: unknown): CapabilitySets | null {
  const fields = ["effective", "permitted", "inheritable", "ambient", "bounding"] as const;
  const record = snapshotExactDataRecord(value, fields);
  const values = fields.map((field) => record?.[field]);
  const canonicalMask = /^(?:0|[1-9a-f][0-9a-f]{0,15})$/u;
  if (values.some((item) => typeof item !== "string" || !canonicalMask.test(item))) return null;
  return Object.freeze({
    effective: values[0] as string,
    permitted: values[1] as string,
    inheritable: values[2] as string,
    ambient: values[3] as string,
    bounding: values[4] as string,
  });
}

function snapshotNoNewPrivileges(value: unknown): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

function snapshotFact<T>(
  value: unknown,
  snapshotValue: (candidate: unknown) => T | null,
): { valid: true; value: T | null } | { valid: false } {
  const missingRecord = snapshotExactDataRecord(value, ["state"]);
  if (missingRecord?.["state"] === "missing") return { valid: true, value: null };
  const observedRecord = snapshotExactDataRecord(value, ["state", "value"]);
  if (observedRecord?.["state"] !== "observed") return { valid: false };
  const snapshot = snapshotValue(observedRecord["value"]);
  return snapshot === null ? { valid: false } : { valid: true, value: snapshot };
}

function snapshotFacts(candidate: unknown): Snapshot | null {
  const record = snapshotExactDataRecord(candidate, [
    "schema",
    "guestPlatform",
    "processIdentity",
    "overflowIds",
    "userNamespaceMaps",
    "capabilitySets",
    "noNewPrivileges",
  ]);
  if (record?.["schema"] !== SCHEMA) return null;
  const guestPlatform = snapshotFact(record["guestPlatform"], snapshotGuestPlatform);
  const processIdentity = snapshotFact(record["processIdentity"], snapshotProcessIdentity);
  const overflowIds = snapshotFact(record["overflowIds"], snapshotOverflowIds);
  const userNamespaceMaps = snapshotFact(record["userNamespaceMaps"], snapshotUserNamespaceMaps);
  const capabilitySets = snapshotFact(record["capabilitySets"], snapshotCapabilitySets);
  const noNewPrivileges = snapshotFact(record["noNewPrivileges"], snapshotNoNewPrivileges);
  if (
    !guestPlatform.valid ||
    !processIdentity.valid ||
    !overflowIds.valid ||
    !userNamespaceMaps.valid ||
    !capabilitySets.valid ||
    !noNewPrivileges.valid
  ) {
    return null;
  }
  return Object.freeze({
    guestPlatform: guestPlatform.value,
    processIdentity: processIdentity.value,
    overflowIds: overflowIds.value,
    userNamespaceMaps: userNamespaceMaps.value,
    capabilitySets: capabilitySets.value,
    noNewPrivileges: noNewPrivileges.value,
  });
}

function includesId(entries: readonly IdMapEntry[], id: number): boolean {
  return entries.some((entry) => id >= entry.insideStart && id < entry.insideStart + entry.length);
}

function idValues(ids: LinuxIds): readonly number[] {
  return [ids.real, ids.effective, ids.saved, ids.filesystem];
}

function classify(snapshot: Snapshot): LinuxRootlessPrivilegeClassification {
  const missing: PrivilegeFactId[] = [];
  if (snapshot.guestPlatform === null) missing.push("guest_platform");
  if (snapshot.processIdentity === null) missing.push("process_identity");
  if (snapshot.overflowIds === null) missing.push("overflow_ids");
  if (snapshot.userNamespaceMaps === null) missing.push("user_namespace_maps");
  if (snapshot.capabilitySets === null) missing.push("capability_sets");
  if (snapshot.noNewPrivileges === null) missing.push("no_new_privileges");

  const contradictions: PrivilegeContradiction[] = [];
  const ambiguities: PrivilegeAmbiguity[] = [];
  if (
    snapshot.guestPlatform !== null &&
    (snapshot.guestPlatform.os !== "linux" || snapshot.guestPlatform.architecture !== "amd64")
  ) {
    contradictions.push("platform_not_linux_amd64");
  }
  if (snapshot.processIdentity !== null) {
    if (idValues(snapshot.processIdentity.uids).includes(0)) {
      contradictions.push("process_has_root_uid");
    }
    if (idValues(snapshot.processIdentity.gids).includes(0)) {
      contradictions.push("process_has_root_gid");
    }
    if (snapshot.processIdentity.supplementaryGids.includes(0)) {
      contradictions.push("process_has_root_supplementary_gid");
    }
    if (
      snapshot.overflowIds !== null &&
      idValues(snapshot.processIdentity.uids).includes(snapshot.overflowIds.uid)
    ) {
      ambiguities.push("process_uid_matches_overflow_id");
    }
    if (
      snapshot.overflowIds !== null &&
      [
        ...idValues(snapshot.processIdentity.gids),
        ...snapshot.processIdentity.supplementaryGids,
      ].includes(snapshot.overflowIds.gid)
    ) {
      ambiguities.push("process_gid_matches_overflow_id");
    }
  }
  if (snapshot.userNamespaceMaps !== null) {
    if (
      snapshot.processIdentity !== null &&
      idValues(snapshot.processIdentity.uids).some(
        (id) => !includesId(snapshot.userNamespaceMaps?.uid ?? [], id),
      )
    ) {
      contradictions.push("process_uid_not_mapped");
    }
    if (
      snapshot.processIdentity !== null &&
      [
        ...idValues(snapshot.processIdentity.gids),
        ...snapshot.processIdentity.supplementaryGids,
      ].some((id) => !includesId(snapshot.userNamespaceMaps?.gid ?? [], id))
    ) {
      contradictions.push("process_gid_not_mapped");
    }
    if (snapshot.userNamespaceMaps.uid.some((entry) => entry.outsideStart === 0)) {
      contradictions.push("parent_root_uid_mapped");
    }
    if (snapshot.userNamespaceMaps.gid.some((entry) => entry.outsideStart === 0)) {
      contradictions.push("parent_root_gid_mapped");
    }
  }
  if (snapshot.capabilitySets !== null) {
    const capabilityChecks = [
      [snapshot.capabilitySets.effective, "effective_capabilities_nonzero"],
      [snapshot.capabilitySets.permitted, "permitted_capabilities_nonzero"],
      [snapshot.capabilitySets.inheritable, "inheritable_capabilities_nonzero"],
      [snapshot.capabilitySets.ambient, "ambient_capabilities_nonzero"],
      [snapshot.capabilitySets.bounding, "bounding_capabilities_nonzero"],
    ] as const;
    for (const [mask, contradiction] of capabilityChecks) {
      if (mask !== "0") contradictions.push(contradiction);
    }
  }
  if (snapshot.noNewPrivileges === 0) contradictions.push("no_new_privileges_disabled");

  if (contradictions.length > 0) {
    return Object.freeze({
      kind: "contradictory",
      contradictions: Object.freeze(contradictions),
      missing: Object.freeze(missing),
    });
  }
  if (ambiguities.length > 0) {
    return Object.freeze({
      kind: "ambiguous",
      ambiguities: Object.freeze(ambiguities),
      missing: Object.freeze(missing),
    });
  }
  if (missing.length > 0) {
    return Object.freeze({ kind: "missing", missing: Object.freeze(missing) });
  }
  return NO_CONTRADICTION;
}

/**
 * Classifies only the Linux guest privilege-floor subset. This function does
 * not authenticate evidence or establish backend qualification, authorization,
 * containment, a receipt, a ledger, a verdict, or proof.
 */
export function classifyLinuxRootlessPrivilegeFacts(
  candidate: unknown,
): LinuxRootlessPrivilegeClassification {
  try {
    const snapshot = snapshotFacts(candidate);
    return snapshot === null ? INVALID_SNAPSHOT : classify(snapshot);
  } catch {
    return INVALID_SNAPSHOT;
  }
}
