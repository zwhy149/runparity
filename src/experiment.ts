import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import { isProxy } from "node:util/types";

const baseArms = new WeakMap<object, BaseArmState>();
const experimentSpecs = new WeakMap<object, ExperimentPlanState>();

type Digest = string;

const FIXED_INPUT_KEYS = [
  "environment_remainder_sha256",
  "source_sha256",
  "input_sha256",
  "mounts_sha256",
  "runtime_slots_sha256",
  "artifact_slots_sha256",
  "network_policy_sha256",
  "resource_policy_sha256",
  "output_contract_sha256",
] as const;

export type FixedInputDigests = {
  [Key in (typeof FIXED_INPUT_KEYS)[number]]: Digest;
};

export type BaseArmInput = {
  schema_version: "runparity.base-arm/1";
  command: {
    executable: string;
    argv: string[];
    working_directory: string;
  };
  path: {
    style: "posix" | "windows";
    entries: string[];
  };
  fixed: FixedInputDigests;
};

export type FrozenBaseArm = object;

export type CompileExperimentInput = {
  base_arm: FrozenBaseArm;
  digests: {
    base_sha256: Digest;
    qualification_sha256: Digest;
    oracle_sha256: Digest;
  };
  intervention: {
    type: "path.prepend";
    directory: string;
  };
  freshness_ids: {
    a1: string;
    b: string;
    a2: string;
  };
};

export type ExperimentSpec = object;

type BaseArmState = Readonly<{
  schema_version: "runparity.base-arm/1";
  command: Readonly<{
    executable: string;
    argv: readonly string[];
    working_directory: string;
  }>;
  path: Readonly<{
    style: "posix" | "windows";
    entries: readonly string[];
  }>;
  fixed: Readonly<FixedInputDigests>;
}>;

type ArmProjection = {
  identity: "A1" | "B" | "A2";
  freshness_id: string;
  base_sha256: Digest;
  command: {
    executable: string;
    argv: string[];
    working_directory: string;
  };
  path: {
    style: "posix" | "windows";
    entries: string[];
  };
  fixed: Record<string, Digest>;
  delta: { type: "path.prepend"; directory: string } | null;
};

type ArmSummary = {
  identity: ArmProjection["identity"];
  freshness_id: string;
  base_sha256: Digest;
  delta: { type: "path.prepend" } | null;
};

type ExperimentPlanState = Readonly<{
  base_sha256: Digest;
  qualification_sha256: Digest;
  oracle_sha256: Digest;
  arms: {
    a1: ArmProjection;
    b: ArmProjection;
    a2: ArmProjection;
  };
}>;

function failClosed(reason: string): never {
  throw new Error(`RP_EXPERIMENT_INVALID_INPUT: ${reason}`);
}

function isSha256(value: unknown): value is Digest {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  const actualKeys = isPlainRecord(value) ? Reflect.ownKeys(value) : [];
  return (
    isPlainRecord(value) &&
    actualKeys.length === keys.length &&
    actualKeys.every((key) => typeof key === "string") &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function assertInertData(value: unknown, seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value !== "object" || isProxy(value) || seen.has(value)) {
    failClosed("input must be acyclic inert data without proxies.");
  }

  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    failClosed("input contains an unsupported object prototype.");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (typeof key !== "string") {
      failClosed("input contains a symbol key.");
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
      failClosed("input contains an accessor.");
    }
    if (isArray && key === "length") {
      continue;
    }
    if (!descriptor.enumerable) {
      failClosed("input contains hidden data.");
    }
    assertInertData(descriptor.value, seen);
  }

  if (isArray) {
    const array = value as unknown[];
    const enumerableKeys = keys.filter((key) => key !== "length");
    if (
      enumerableKeys.length !== array.length ||
      enumerableKeys.some((key, index) => key !== String(index))
    ) {
      failClosed("input contains a sparse or decorated array.");
    }
  }
  seen.delete(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? failClosed("input contains a non-JSON value.") : serialized;
}

function validatedBaseArm(input: BaseArmInput): BaseArmState {
  if (!hasExactKeys(input, ["schema_version", "command", "path", "fixed"])) {
    return failClosed("invalid base-arm shape.");
  }
  if (input.schema_version !== "runparity.base-arm/1") {
    return failClosed("unsupported base-arm schema.");
  }
  if (
    !hasExactKeys(input.command, ["executable", "argv", "working_directory"]) ||
    typeof input.command.executable !== "string" ||
    typeof input.command.working_directory !== "string" ||
    !Array.isArray(input.command.argv) ||
    input.command.argv.some((value) => typeof value !== "string")
  ) {
    return failClosed("invalid command snapshot.");
  }
  if (
    !hasExactKeys(input.path, ["style", "entries"]) ||
    (input.path.style !== "posix" && input.path.style !== "windows") ||
    !Array.isArray(input.path.entries) ||
    input.path.entries.some((value) => typeof value !== "string")
  ) {
    return failClosed("invalid PATH snapshot.");
  }
  if (
    !hasExactKeys(input.fixed, FIXED_INPUT_KEYS) ||
    Object.values(input.fixed).some((value) => !isSha256(value))
  ) {
    return failClosed("invalid fixed-input digest.");
  }
  return deepFreeze(clone(input)) as BaseArmState;
}

export function createFrozenBaseArm(input: BaseArmInput): FrozenBaseArm {
  assertInertData(input);
  const token = Object.freeze({});
  baseArms.set(token, validatedBaseArm(input));
  return token;
}

export function digestFrozenBaseArm(baseArm: FrozenBaseArm): Digest {
  const state = baseArms.get(baseArm);
  if (state === undefined) {
    return failClosed("unrecognized base-arm token.");
  }
  return createHash("sha256").update(canonicalJson(state)).digest("hex");
}

function normalizedDirectory(directory: string, style: "posix" | "windows"): string {
  if (
    typeof directory !== "string" ||
    directory.length === 0 ||
    [...directory].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 31 || code === 127);
    })
  ) {
    return failClosed("invalid intervention directory.");
  }
  if (style === "posix") {
    if (!posix.isAbsolute(directory) || directory.startsWith("//")) {
      return failClosed("path.prepend requires an unambiguous POSIX absolute directory.");
    }
    return posix.normalize(directory);
  }

  if (
    directory.startsWith("\\\\") ||
    !/^[A-Za-z]:[\\/]/u.test(directory) ||
    directory.slice(2).includes(":")
  ) {
    return failClosed("path.prepend requires a drive-qualified Windows absolute directory.");
  }
  const normalized = win32.normalize(directory);
  return `${normalized[0]?.toUpperCase()}${normalized.slice(1)}`;
}

function validateCompileInput(input: CompileExperimentInput): {
  base: BaseArmState;
  directory: string;
} {
  assertInertData(input);
  if (!hasExactKeys(input, ["base_arm", "digests", "intervention", "freshness_ids"])) {
    return failClosed("invalid experiment shape.");
  }
  if (!hasExactKeys(input.digests, ["base_sha256", "qualification_sha256", "oracle_sha256"])) {
    return failClosed("invalid digest shape.");
  }
  if (!hasExactKeys(input.intervention, ["type", "directory"])) {
    return failClosed("invalid intervention shape.");
  }
  if (!hasExactKeys(input.freshness_ids, ["a1", "b", "a2"])) {
    return failClosed("invalid freshness identity shape.");
  }
  const base = baseArms.get(input.base_arm);
  if (base === undefined) {
    return failClosed("unrecognized base-arm token.");
  }
  if (
    !isSha256(input.digests.base_sha256) ||
    !isSha256(input.digests.qualification_sha256) ||
    !isSha256(input.digests.oracle_sha256) ||
    input.digests.base_sha256 !== digestFrozenBaseArm(input.base_arm)
  ) {
    return failClosed("invalid or mismatched plan digest.");
  }
  if (input.intervention.type !== "path.prepend") {
    return failClosed("unsupported intervention.");
  }
  const freshness = Object.values(input.freshness_ids);
  if (
    freshness.some(
      (value) => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value),
    ) ||
    new Set(freshness).size !== freshness.length
  ) {
    return failClosed("freshness identities must be non-empty and unique.");
  }
  return { base, directory: normalizedDirectory(input.intervention.directory, base.path.style) };
}

function createArm(
  base: BaseArmState,
  baseSha256: Digest,
  identity: ArmProjection["identity"],
  freshnessId: string,
  delta: ArmProjection["delta"],
): ArmProjection {
  return {
    identity,
    freshness_id: freshnessId,
    base_sha256: baseSha256,
    command: {
      executable: base.command.executable,
      argv: [...base.command.argv],
      working_directory: base.command.working_directory,
    },
    path: {
      style: base.path.style,
      entries: delta === null ? [...base.path.entries] : [delta.directory, ...base.path.entries],
    },
    fixed: clone(base.fixed),
    delta: delta === null ? null : { ...delta },
  };
}

export function compileExperiment(input: CompileExperimentInput): ExperimentSpec {
  const { base, directory } = validateCompileInput(input);
  const delta = { type: "path.prepend" as const, directory };
  const token = Object.freeze({});
  experimentSpecs.set(
    token,
    deepFreeze({
      base_sha256: input.digests.base_sha256,
      qualification_sha256: input.digests.qualification_sha256,
      oracle_sha256: input.digests.oracle_sha256,
      arms: {
        a1: createArm(base, input.digests.base_sha256, "A1", input.freshness_ids.a1, null),
        b: createArm(base, input.digests.base_sha256, "B", input.freshness_ids.b, delta),
        a2: createArm(base, input.digests.base_sha256, "A2", input.freshness_ids.a2, null),
      },
    }),
  );
  return token;
}

export function inspectExperimentSpec(spec: ExperimentSpec): Readonly<{
  status: "COMPILED_PLAN_ONLY";
  digests: {
    base_sha256: Digest;
    qualification_sha256: Digest;
    oracle_sha256: Digest;
  };
  arms: {
    a1: ArmSummary;
    b: ArmSummary;
    a2: ArmSummary;
  };
}> {
  const state = experimentSpecs.get(spec);
  if (state === undefined) {
    return failClosed("unrecognized experiment token.");
  }
  const summarize = (arm: ArmProjection) => ({
    identity: arm.identity,
    freshness_id: arm.freshness_id,
    base_sha256: arm.base_sha256,
    delta: arm.delta === null ? null : { type: arm.delta.type },
  });
  return deepFreeze({
    status: "COMPILED_PLAN_ONLY",
    digests: {
      base_sha256: state.base_sha256,
      qualification_sha256: state.qualification_sha256,
      oracle_sha256: state.oracle_sha256,
    },
    arms: {
      a1: summarize(state.arms.a1),
      b: summarize(state.arms.b),
      a2: summarize(state.arms.a2),
    },
  });
}
