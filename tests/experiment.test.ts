import { describe, expect, test } from "vitest";
import type { BaseArmInput } from "../src/experiment.js";
import {
  compileExperiment,
  createFrozenBaseArm,
  digestFrozenBaseArm,
  inspectExperimentSpec,
} from "../src/experiment.js";

const digest = (character: string): string => character.repeat(64);

function completeFixed(): BaseArmInput["fixed"] {
  return {
    environment_remainder_sha256: digest("1"),
    source_sha256: digest("2"),
    input_sha256: digest("3"),
    mounts_sha256: digest("4"),
    runtime_slots_sha256: digest("5"),
    artifact_slots_sha256: digest("6"),
    network_policy_sha256: digest("7"),
    resource_policy_sha256: digest("8"),
    output_contract_sha256: digest("9"),
  };
}

function baseArm() {
  return createFrozenBaseArm({
    schema_version: "runparity.base-arm/1",
    command: {
      executable: "/opt/runtime/bin/node",
      argv: ["/workspace/assert.mjs"],
      working_directory: "/workspace",
    },
    path: {
      style: "posix",
      entries: ["/shadow/bin", "/usr/bin"],
    },
    fixed: completeFixed(),
  });
}

function compilePathExperiment() {
  const base = baseArm();
  return compileExperiment({
    base_arm: base,
    digests: {
      base_sha256: digestFrozenBaseArm(base),
      qualification_sha256: digest("a"),
      oracle_sha256: digest("b"),
    },
    intervention: {
      type: "path.prepend",
      directory: "/approved/bin/",
    },
    freshness_ids: {
      a1: "sequence-1-a1",
      b: "sequence-1-b",
      a2: "sequence-1-a2",
    },
  });
}

describe("ExperimentCompiler", () => {
  test("compiles one normalized path.prepend delta without claiming proof", () => {
    const spec = compilePathExperiment();
    const projection = inspectExperimentSpec(spec);

    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.keys(spec)).toEqual([]);
    expect(JSON.stringify(spec)).toBe("{}");
    expect(projection.status).toBe("COMPILED_PLAN_ONLY");
    expect(JSON.stringify(projection)).not.toContain("VERIFIED_INTERVENTION");
    expect(projection.arms.b.delta).toEqual({ type: "path.prepend" });
    expect(JSON.stringify(projection)).not.toContain("/workspace/assert.mjs");
    expect(JSON.stringify(projection)).not.toContain("/approved/bin");
    expect(JSON.stringify(projection)).not.toContain("/shadow/bin");
  });

  test("rebuilds equivalent A controls and gives B exactly one path delta", () => {
    const projection = inspectExperimentSpec(compilePathExperiment());

    expect(projection.arms.a1).toMatchObject({ identity: "A1", delta: null });
    expect(projection.arms.b).toMatchObject({
      identity: "B",
      delta: { type: "path.prepend" },
    });
    expect(projection.arms.a2).toMatchObject({ identity: "A2", delta: null });
    expect(projection.arms.a1.base_sha256).toBe(projection.arms.a2.base_sha256);
    expect(projection.arms.b.base_sha256).toBe(projection.arms.a1.base_sha256);
  });

  test("snapshots inputs and cannot be mutated through an inspection projection", () => {
    const raw: BaseArmInput = {
      schema_version: "runparity.base-arm/1",
      command: {
        executable: "/opt/runtime/bin/node",
        argv: ["/workspace/assert.mjs"],
        working_directory: "/workspace",
      },
      path: { style: "posix", entries: ["/shadow/bin", "/usr/bin"] },
      fixed: completeFixed(),
    };
    const base = createFrozenBaseArm(raw);
    const frozenDigest = digestFrozenBaseArm(base);
    raw.command.argv[0] = "/attacker/changed.mjs";
    raw.path.entries.unshift("/attacker/bin");
    raw.fixed["environment_remainder_sha256"] = digest("f");

    const spec = compileExperiment({
      base_arm: base,
      digests: {
        base_sha256: frozenDigest,
        qualification_sha256: digest("a"),
        oracle_sha256: digest("b"),
      },
      intervention: { type: "path.prepend", directory: "/approved/bin" },
      freshness_ids: { a1: "a1", b: "b", a2: "a2" },
    });
    const projection = inspectExperimentSpec(spec);
    expect(() => {
      (projection.arms.b as { identity: string }).identity = "A1";
    }).toThrow(TypeError);
    expect(inspectExperimentSpec(spec).arms.b).toMatchObject({
      identity: "B",
      delta: { type: "path.prepend" },
    });
  });

  test("fails closed for untyped changes, stale digests, and non-fresh controls", () => {
    const base = baseArm();
    const common = {
      base_arm: base,
      digests: {
        base_sha256: digestFrozenBaseArm(base),
        qualification_sha256: digest("a"),
        oracle_sha256: digest("b"),
      },
      intervention: { type: "path.prepend" as const, directory: "/approved/bin" },
      freshness_ids: { a1: "a1", b: "b", a2: "a2" },
    };

    expect(() =>
      compileExperiment({
        ...common,
        intervention: { type: "environment.set", name: "PATH" },
      } as never),
    ).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    expect(() =>
      compileExperiment({
        ...common,
        digests: { ...common.digests, base_sha256: digest("0") },
      }),
    ).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    expect(() =>
      compileExperiment({ ...common, freshness_ids: { a1: "reused", b: "b", a2: "reused" } }),
    ).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    expect(() =>
      compileExperiment({
        ...common,
        intervention: {
          type: "path.prepend",
          directory: "/approved/bin",
          unregistered_second_change: "/attacker/bin",
        },
      } as never),
    ).toThrow("RP_EXPERIMENT_INVALID_INPUT");
  });

  test("preserves Windows drive roots and rejects ambient-dependent path forms", () => {
    const base = createFrozenBaseArm({
      schema_version: "runparity.base-arm/1",
      command: {
        executable: "C:\\runtime\\node.exe",
        argv: ["C:\\workspace\\assert.mjs"],
        working_directory: "C:\\workspace",
      },
      path: { style: "windows", entries: ["C:\\shadow\\bin", "C:\\Windows\\System32"] },
      fixed: completeFixed(),
    });
    const common = {
      base_arm: base,
      digests: {
        base_sha256: digestFrozenBaseArm(base),
        qualification_sha256: digest("a"),
        oracle_sha256: digest("b"),
      },
      freshness_ids: { a1: "a1", b: "b", a2: "a2" },
    };

    expect(() =>
      compileExperiment({
        ...common,
        intervention: { type: "path.prepend", directory: "C:\\" },
      }),
    ).not.toThrow();
    for (const directory of [
      "C:relative",
      "\\current-drive",
      "..\\relative",
      "\\\\server\\share",
    ]) {
      expect(() =>
        compileExperiment({
          ...common,
          intervention: { type: "path.prepend", directory },
        }),
      ).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    }
  });

  test("rejects accessors and proxies without invoking caller code", () => {
    const normal = {
      schema_version: "runparity.base-arm/1" as const,
      command: {
        executable: "/opt/runtime/bin/node",
        argv: ["/workspace/assert.mjs"],
        working_directory: "/workspace",
      },
      path: { style: "posix" as const, entries: ["/usr/bin"] },
      fixed: completeFixed(),
    };
    let getterCalls = 0;
    Object.defineProperty(normal.command, "executable", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "/attacker/code-ran";
      },
    });
    expect(() => createFrozenBaseArm(normal)).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    expect(getterCalls).toBe(0);

    let proxyReads = 0;
    const proxied = new Proxy(normal, {
      get(target, property, receiver) {
        proxyReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => createFrozenBaseArm(proxied)).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    expect(proxyReads).toBe(0);
  });

  test("uses canonical base digests and requires the complete fixed-input set", () => {
    const first = completeFixed();
    const reverse = Object.fromEntries(Object.entries(first).reverse()) as BaseArmInput["fixed"];
    const create = (fixed: BaseArmInput["fixed"]) =>
      createFrozenBaseArm({
        schema_version: "runparity.base-arm/1",
        command: {
          executable: "/opt/runtime/bin/node",
          argv: ["/workspace/assert.mjs"],
          working_directory: "/workspace",
        },
        path: { style: "posix", entries: ["/usr/bin"] },
        fixed,
      });

    expect(digestFrozenBaseArm(create(first))).toBe(digestFrozenBaseArm(create(reverse)));
    expect(() =>
      create({
        ...first,
        source_sha256: digest("A"),
      }),
    ).toThrow("RP_EXPERIMENT_INVALID_INPUT");
    const { source_sha256: _missing, ...incomplete } = first;
    expect(() => create(incomplete as BaseArmInput["fixed"])).toThrow(
      "RP_EXPERIMENT_INVALID_INPUT",
    );
  });
});
