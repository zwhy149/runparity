import type { ArmMount } from "../backend/arm-isolation-policy.js";
import type { FrozenOracleV1 } from "./oracle-evaluator.js";

/**
 * Case execution registry for the twelve supported positives.
 *
 * Every plan expresses the A1/A2 baseline and the B intervention as full arm
 * specs whose podman argv may differ in EXACTLY ONE normalized token — the
 * declared typed intervention. Four mechanical delta kinds cover all four
 * diagnosis families:
 *
 *   path.prepend  — one PATH environment token gains one prefix directory
 *   env.value     — one environment token's value is replaced
 *   mount.source  — one -v mount token binds a different source to the same
 *                   fixed container slot (runtime slot, pnpm slot, project)
 *   argv.token    — one target argv token is replaced (CLI flag value)
 *
 * The proof-ledger verifier and the independent fixture validator both
 * recompute the single-token delta and its kind semantics from the embedded
 * normalized argv before any verdict is accepted.
 */

export type InterventionKind = "path.prepend" | "env.value" | "mount.source" | "argv.token";

export type InterventionDescriptor = Readonly<{
  type: string;
  kind: InterventionKind;
  envName?: string;
  value?: string;
  containerPath?: string;
  argvFrom?: string;
  argvTo?: string;
  directory?: string;
}>;

export type ArmSpec = Readonly<{
  environment: Readonly<Record<string, string>>;
  targetArgv: readonly string[];
  homePrep?: readonly (readonly string[])[];
  extraMounts?: readonly ArmMount[];
}>;

export type ExternalArtifact = Readonly<{
  role: string;
  hostPath: string;
  sha256: string;
}>;

export type CaseFamily =
  | "PATH_SHADOWING"
  | "RUNTIME_MANAGER_DRIFT"
  | "CONFIG_PRECEDENCE"
  | "NATIVE_ABI_ARCH_MISMATCH";

export type CasePlan = Readonly<{
  caseId: string;
  caseSlug: string;
  family: CaseFamily;
  assetSubdir: string;
  workingDirectory: string;
  repetitions: 3;
  baseline: ArmSpec;
  intervention: ArmSpec;
  interventionDescriptor: InterventionDescriptor;
  oracle: FrozenOracleV1;
  externalArtifacts?: readonly ExternalArtifact[];
}>;

const SYSTEM_PATH_TAIL = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function baseEnv(extra: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return Object.freeze({ HOME: "/home/arm", ...extra });
}

function oracleFor(caseId: string): FrozenOracleV1 {
  return Object.freeze({
    type: "exit_code_and_stdout",
    exit_code: 0,
    stdout_contains: `RUNPARITY_OK:${caseId.toLowerCase()}`,
  });
}

function ro(hostDir: string, containerPath: string): ArmMount {
  return Object.freeze({ hostDir, containerPath, options: "ro" });
}

// --- PATH_SHADOWING -----------------------------------------------------------

const PATH_001: CasePlan = Object.freeze({
  caseId: "DEV-PATH-001",
  caseSlug: "rp-dev-path-001",
  family: "PATH_SHADOWING",
  assetSubdir: "DEV-PATH-001",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/assets/wrong-node/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze(["node", "fixture/assert-node-marker.mjs"]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/assets/intended-node/bin:/arm/assets/wrong-node/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze(["node", "fixture/assert-node-marker.mjs"]),
  }),
  interventionDescriptor: Object.freeze({
    type: "path.prepend",
    kind: "path.prepend",
    envName: "PATH",
    directory: "/arm/assets/intended-node/bin",
  }),
  oracle: oracleFor("DEV-PATH-001"),
});

const PATH_002: CasePlan = Object.freeze({
  caseId: "DEV-PATH-002",
  caseSlug: "rp-dev-path-002",
  family: "PATH_SHADOWING",
  assetSubdir: "DEV-PATH-002",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/assets/stale-pnpm/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze(["pnpm", "exec", "node", "fixture/assert-pnpm-marker.mjs"]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/assets/approved-pnpm/bin:/arm/assets/stale-pnpm/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze(["pnpm", "exec", "node", "fixture/assert-pnpm-marker.mjs"]),
  }),
  interventionDescriptor: Object.freeze({
    type: "path.prepend",
    kind: "path.prepend",
    envName: "PATH",
    directory: "/arm/assets/approved-pnpm/bin",
  }),
  oracle: oracleFor("DEV-PATH-002"),
});

const PATH_003: CasePlan = Object.freeze({
  caseId: "DEV-PATH-003",
  caseSlug: "rp-dev-path-003",
  family: "PATH_SHADOWING",
  assetSubdir: "DEV-PATH-003",
  workingDirectory: "/home/arm/work",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: `/home/arm/work/preexisting/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze([
      "node",
      "fixture/assert-toolchain-marker.mjs",
      "--assert-compatible",
    ]),
    homePrep: Object.freeze([
      Object.freeze(["mkdir", "-p", "{armHome}/work/preexisting/bin"]),
      Object.freeze(["mkdir", "-p", "{armHome}/work/link-hops"]),
      Object.freeze(["cp", "-r", "{assets}/.", "{armHome}/work"]),
      Object.freeze([
        "ln",
        "-s",
        "../../link-hops/node-hop",
        "{armHome}/work/preexisting/bin/node",
      ]),
      Object.freeze([
        "ln",
        "-s",
        "../unintended-toolchain/bin/node-target",
        "{armHome}/work/link-hops/node-hop",
      ]),
    ]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/assets/repository-fixture/bin:/home/arm/work/preexisting/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze([
      "node",
      "fixture/assert-toolchain-marker.mjs",
      "--assert-compatible",
    ]),
    homePrep: Object.freeze([
      Object.freeze(["mkdir", "-p", "{armHome}/work/preexisting/bin"]),
      Object.freeze(["mkdir", "-p", "{armHome}/work/link-hops"]),
      Object.freeze(["cp", "-r", "{assets}/.", "{armHome}/work"]),
      Object.freeze([
        "ln",
        "-s",
        "../../link-hops/node-hop",
        "{armHome}/work/preexisting/bin/node",
      ]),
      Object.freeze([
        "ln",
        "-s",
        "../unintended-toolchain/bin/node-target",
        "{armHome}/work/link-hops/node-hop",
      ]),
    ]),
  }),
  interventionDescriptor: Object.freeze({
    type: "path.prepend",
    kind: "path.prepend",
    envName: "PATH",
    directory: "/arm/assets/repository-fixture/bin",
  }),
  oracle: oracleFor("DEV-PATH-003"),
});

// --- RUNTIME_MANAGER_DRIFT ----------------------------------------------------

const RUNTIME_001: CasePlan = Object.freeze({
  caseId: "DEV-RUNTIME-001",
  caseSlug: "rp-dev-runtime-001",
  family: "RUNTIME_MANAGER_DRIFT",
  assetSubdir: "DEV-RUNTIME-001",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/runtimeslot/bin:${SYSTEM_PATH_TAIL}`,
    }),
    targetArgv: Object.freeze(["node", "fixture/assert-engines-range.mjs"]),
    extraMounts: Object.freeze([ro("/home/rp/assets-external/node-24.15.0", "/arm/runtimeslot")]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/runtimeslot/bin:${SYSTEM_PATH_TAIL}`,
    }),
    targetArgv: Object.freeze(["node", "fixture/assert-engines-range.mjs"]),
    extraMounts: Object.freeze([ro("/home/rp/assets-external/node-22.23.2", "/arm/runtimeslot")]),
  }),
  interventionDescriptor: Object.freeze({
    type: "runtime.select",
    kind: "mount.source",
    containerPath: "/arm/runtimeslot",
  }),
  oracle: oracleFor("DEV-RUNTIME-001"),
  externalArtifacts: Object.freeze([
    {
      role: "wrong_runtime_node",
      hostPath: "/home/rp/assets-external/node-24.15.0/bin/node",
      sha256: "d1de76d8edf2fededf6f8b30d244e2c0529ac607923a018283b77e9c74bd932c",
    },
    {
      role: "matching_runtime_node",
      hostPath: "/home/rp/assets-external/node-22.23.2/bin/node",
      sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327",
    },
  ]),
});

const RUNTIME_002: CasePlan = Object.freeze({
  caseId: "DEV-RUNTIME-002",
  caseSlug: "rp-dev-runtime-002",
  family: "RUNTIME_MANAGER_DRIFT",
  assetSubdir: "DEV-RUNTIME-002",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/pnpmslot/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze(["pnpm", "exec", "node", "fixture/assert-manager-version.mjs"]),
    extraMounts: Object.freeze([ro("{assets}/wrong-version-pnpm", "/arm/pnpmslot")]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/pnpmslot/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
    }),
    targetArgv: Object.freeze(["pnpm", "exec", "node", "fixture/assert-manager-version.mjs"]),
    extraMounts: Object.freeze([ro("{assets}/approved-pnpm", "/arm/pnpmslot")]),
  }),
  interventionDescriptor: Object.freeze({
    type: "runtime.select",
    kind: "mount.source",
    containerPath: "/arm/pnpmslot",
  }),
  oracle: oracleFor("DEV-RUNTIME-002"),
});

const RUNTIME_003: CasePlan = Object.freeze({
  caseId: "DEV-RUNTIME-003",
  caseSlug: "rp-dev-runtime-003",
  family: "RUNTIME_MANAGER_DRIFT",
  assetSubdir: "DEV-RUNTIME-003",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/pnpmslot/bin:/arm/assets/runtime-manager/approved/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
      RUNPARITY_FIXTURE_EXPECTED_RUNTIME_ROLE: "approved",
    }),
    targetArgv: Object.freeze(["pnpm", "run", "assert-runtime-provenance"]),
    extraMounts: Object.freeze([ro("{assets}/pnpm-launcher", "/arm/pnpmslot")]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: `/arm/pnpmslot/bin:/arm/assets/runtime-manager/approved/bin:${SYSTEM_PATH_TAIL}`,
      RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
      RUNPARITY_FIXTURE_EXPECTED_RUNTIME_ROLE: "approved",
    }),
    targetArgv: Object.freeze(["pnpm", "run", "assert-runtime-provenance"]),
    extraMounts: Object.freeze([ro("{assets}/pnpm-launcher-approved", "/arm/pnpmslot")]),
  }),
  interventionDescriptor: Object.freeze({
    type: "runtime.select",
    kind: "mount.source",
    containerPath: "/arm/pnpmslot",
  }),
  oracle: oracleFor("DEV-RUNTIME-003"),
});

// --- CONFIG_PRECEDENCE --------------------------------------------------------

const CONFIG_001: CasePlan = Object.freeze({
  caseId: "DEV-CONFIG-001",
  caseSlug: "rp-dev-config-001",
  family: "CONFIG_PRECEDENCE",
  assetSubdir: "DEV-CONFIG-001",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: SYSTEM_PATH_TAIL,
      npm_config_fund: "false",
    }),
    targetArgv: Object.freeze(["npm", "run", "fixture:assert-config"]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: SYSTEM_PATH_TAIL,
      npm_config_fund: "true",
    }),
    targetArgv: Object.freeze(["npm", "run", "fixture:assert-config"]),
  }),
  interventionDescriptor: Object.freeze({
    type: "config.set",
    kind: "env.value",
    envName: "npm_config_fund",
    value: "true",
  }),
  oracle: oracleFor("DEV-CONFIG-001"),
});

const CONFIG_002: CasePlan = Object.freeze({
  caseId: "DEV-CONFIG-002",
  caseSlug: "rp-dev-config-002",
  family: "CONFIG_PRECEDENCE",
  assetSubdir: "DEV-CONFIG-002",
  workingDirectory: "/arm/project",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({ PATH: SYSTEM_PATH_TAIL }),
    targetArgv: Object.freeze(["npm", "run", "fixture:assert-config"]),
    homePrep: Object.freeze([Object.freeze(["cp", "-r", "{assets}/home/.", "{armHome}/"])]),
    extraMounts: Object.freeze([ro("{assets}", "/arm/project")]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({ PATH: SYSTEM_PATH_TAIL }),
    targetArgv: Object.freeze(["npm", "run", "fixture:assert-config"]),
    homePrep: Object.freeze([
      Object.freeze(["cp", "-r", "{assets}/home/.", "{armHome}/"]),
      Object.freeze(["cp", "-r", "{assets}/.", "{armHome}/project"]),
      Object.freeze([
        "cp",
        "-f",
        "{assets}/fixture/npmrc-overlay/.npmrc",
        "{armHome}/project/.npmrc",
      ]),
    ]),
    extraMounts: Object.freeze([ro("{armHome}/project", "/arm/project")]),
  }),
  interventionDescriptor: Object.freeze({
    type: "config.set",
    kind: "mount.source",
    containerPath: "/arm/project",
  }),
  oracle: oracleFor("DEV-CONFIG-002"),
});

const CONFIG_003: CasePlan = Object.freeze({
  caseId: "DEV-CONFIG-003",
  caseSlug: "rp-dev-config-003",
  family: "CONFIG_PRECEDENCE",
  assetSubdir: "DEV-CONFIG-003",
  workingDirectory: "/arm/assets",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({
      PATH: SYSTEM_PATH_TAIL,
      npm_config_fund: "true",
    }),
    targetArgv: Object.freeze(["npm", "run", "fixture:assert-config", "--", "--fund=false"]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({
      PATH: SYSTEM_PATH_TAIL,
      npm_config_fund: "true",
    }),
    targetArgv: Object.freeze(["npm", "run", "fixture:assert-config", "--", "--fund=true"]),
  }),
  interventionDescriptor: Object.freeze({
    type: "config.set",
    kind: "argv.token",
    argvFrom: "--fund=false",
    argvTo: "--fund=true",
  }),
  oracle: oracleFor("DEV-CONFIG-003"),
});

// --- NATIVE_ABI_ARCH_MISMATCH -------------------------------------------------

function nativePlan(caseId: string, slug: string, overlayFile: string): CasePlan {
  return Object.freeze({
    caseId,
    caseSlug: slug,
    family: "NATIVE_ABI_ARCH_MISMATCH",
    assetSubdir: caseId,
    workingDirectory: "/arm/project",
    repetitions: 3,
    baseline: Object.freeze({
      environment: baseEnv({ PATH: SYSTEM_PATH_TAIL }),
      targetArgv: Object.freeze(["node", "fixture/load-native-addon.mjs"]),
      extraMounts: Object.freeze([ro("{assets}", "/arm/project")]),
    }),
    intervention: Object.freeze({
      environment: baseEnv({ PATH: SYSTEM_PATH_TAIL }),
      targetArgv: Object.freeze(["node", "fixture/load-native-addon.mjs"]),
      homePrep: Object.freeze([
        Object.freeze(["cp", "-r", "{assets}/.", "{armHome}/project"]),
        Object.freeze([
          "cp",
          "-f",
          `{assets}/fixture/${overlayFile}`,
          "{armHome}/project/fixture/environment-a.json",
        ]),
      ]),
      extraMounts: Object.freeze([ro("{armHome}/project", "/arm/project")]),
    }),
    interventionDescriptor: Object.freeze({
      type: "nativeArtifact.select",
      kind: "mount.source",
      containerPath: "/arm/project",
    }),
    oracle: oracleFor(caseId),
  });
}

const NATIVE_001: CasePlan = nativePlan(
  "DEV-NATIVE-001",
  "rp-dev-native-001",
  "environment-b.json",
);
const NATIVE_002: CasePlan = nativePlan(
  "DEV-NATIVE-002",
  "rp-dev-native-002",
  "environment-b.json",
);

// NATIVE-003's loader pins the exact Node runtime (22.22.1) that compiled its
// layers, so both arms bind the same external runtime slot; the single
// declared delta remains the project mount source.
const NATIVE_003_RUNTIME_SLOT = "/home/rp/assets-external/node-22.22.1";
const NATIVE_003: CasePlan = Object.freeze({
  caseId: "DEV-NATIVE-003",
  caseSlug: "rp-dev-native-003",
  family: "NATIVE_ABI_ARCH_MISMATCH",
  assetSubdir: "DEV-NATIVE-003",
  workingDirectory: "/arm/project",
  repetitions: 3,
  baseline: Object.freeze({
    environment: baseEnv({ PATH: `/arm/runtimeslot/bin:${SYSTEM_PATH_TAIL}` }),
    targetArgv: Object.freeze(["node", "fixture/load-native-addon.mjs"]),
    extraMounts: Object.freeze([
      ro(NATIVE_003_RUNTIME_SLOT, "/arm/runtimeslot"),
      ro("{assets}", "/arm/project"),
    ]),
  }),
  intervention: Object.freeze({
    environment: baseEnv({ PATH: `/arm/runtimeslot/bin:${SYSTEM_PATH_TAIL}` }),
    targetArgv: Object.freeze(["node", "fixture/load-native-addon.mjs"]),
    homePrep: Object.freeze([
      Object.freeze(["cp", "-r", "{assets}/.", "{armHome}/project"]),
      Object.freeze([
        "cp",
        "-f",
        "{assets}/fixture/environment-b.json",
        "{armHome}/project/fixture/environment-a.json",
      ]),
    ]),
    extraMounts: Object.freeze([
      ro(NATIVE_003_RUNTIME_SLOT, "/arm/runtimeslot"),
      ro("{armHome}/project", "/arm/project"),
    ]),
  }),
  interventionDescriptor: Object.freeze({
    type: "nativeArtifact.select",
    kind: "mount.source",
    containerPath: "/arm/project",
  }),
  oracle: oracleFor("DEV-NATIVE-003"),
  externalArtifacts: Object.freeze([
    {
      role: "pinned_runtime_node",
      hostPath: "/home/rp/assets-external/node-22.22.1/bin/node",
      sha256: "243fd8938011479f41b3de101842150fa990f33fbbb3f7aabd330857f2d79e1d",
    },
  ]),
});

export const CASE_PLANS: Readonly<Record<string, CasePlan>> = Object.freeze({
  "DEV-PATH-001": PATH_001,
  "DEV-PATH-002": PATH_002,
  "DEV-PATH-003": PATH_003,
  "DEV-RUNTIME-001": RUNTIME_001,
  "DEV-RUNTIME-002": RUNTIME_002,
  "DEV-RUNTIME-003": RUNTIME_003,
  "DEV-CONFIG-001": CONFIG_001,
  "DEV-CONFIG-002": CONFIG_002,
  "DEV-CONFIG-003": CONFIG_003,
  "DEV-NATIVE-001": NATIVE_001,
  "DEV-NATIVE-002": NATIVE_002,
  "DEV-NATIVE-003": NATIVE_003,
});

/** Deviation anchor for tests: the original first verified case. */
export const DEV_PATH_001_PLAN = PATH_001;
