import { describe, expect, test } from "vitest";
import { classifyLinuxRootlessPrivilegeFacts } from "../src/oci/linux-rootless-privilege-policy.js";

const factOrder = [
  "guest_platform",
  "process_identity",
  "overflow_ids",
  "user_namespace_maps",
  "capability_sets",
  "no_new_privileges",
] as const;

function validFacts() {
  return {
    schema: "runparity.linux_rootless_privilege_facts/v1",
    guestPlatform: {
      state: "observed",
      value: { os: "linux", architecture: "amd64" },
    },
    processIdentity: {
      state: "observed",
      value: {
        uids: { real: 1000, effective: 1000, saved: 1000, filesystem: 1000 },
        gids: { real: 1000, effective: 1000, saved: 1000, filesystem: 1000 },
        supplementaryGids: [1000, 1001],
      },
    },
    overflowIds: { state: "observed", value: { uid: 65_534, gid: 65_534 } },
    userNamespaceMaps: {
      state: "observed",
      value: {
        view: "target_self_parent",
        uid: [{ insideStart: 1000, outsideStart: 100_000, length: 1 }],
        gid: [{ insideStart: 1000, outsideStart: 200_000, length: 2 }],
      },
    },
    capabilitySets: {
      state: "observed",
      value: {
        effective: "0",
        permitted: "0",
        inheritable: "0",
        ambient: "0",
        bounding: "0",
      },
    },
    noNewPrivileges: { state: "observed", value: 1 },
  };
}

describe("Linux rootless guest privilege policy", () => {
  test("reports only that the complete privilege subset has no contradiction", () => {
    const result = classifyLinuxRootlessPrivilegeFacts(validFacts());

    expect(result).toEqual({
      kind: "no_contradiction_in_privilege_subset",
      scope: "linux_rootless_privilege_floor_v1",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /qualified|qualification|receipt|authorization|ledger|verdict|proof/iu,
    );
  });

  test.each(factOrder)("requires %s to be explicitly observed", (fact) => {
    const input = validFacts();
    const property = {
      guest_platform: "guestPlatform",
      process_identity: "processIdentity",
      overflow_ids: "overflowIds",
      user_namespace_maps: "userNamespaceMaps",
      capability_sets: "capabilitySets",
      no_new_privileges: "noNewPrivileges",
    }[fact] as keyof ReturnType<typeof validFacts>;
    Object.assign(input, { [property]: { state: "missing" } });

    expect(classifyLinuxRootlessPrivilegeFacts(input)).toEqual({
      kind: "missing",
      missing: [fact],
    });
  });

  test("returns every explicit missing fact in one stable policy order", () => {
    const input = validFacts();
    input.guestPlatform = { state: "missing" } as never;
    input.processIdentity = { state: "missing" } as never;
    input.overflowIds = { state: "missing" } as never;
    input.userNamespaceMaps = { state: "missing" } as never;
    input.capabilitySets = { state: "missing" } as never;
    input.noNewPrivileges = { state: "missing" } as never;
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toEqual({
      kind: "missing",
      missing: factOrder,
    });
  });

  test("treats omitted, extra, accessor, proxy, and thenable fields as an invalid snapshot", () => {
    const omitted = validFacts() as Record<string, unknown>;
    delete omitted["capabilitySets"];
    expect(classifyLinuxRootlessPrivilegeFacts(omitted)).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });

    expect(classifyLinuxRootlessPrivilegeFacts({ ...validFacts(), extra: true })).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });
    const thenable = validFacts();
    const thenKey = ["th", "en"].join("");
    Object.defineProperty(thenable, thenKey, { enumerable: true, value: undefined });
    expect(classifyLinuxRootlessPrivilegeFacts(thenable)).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });

    let getterCalls = 0;
    const accessor = validFacts();
    Object.defineProperty(accessor, "guestPlatform", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { state: "missing" };
      },
    });
    expect(classifyLinuxRootlessPrivilegeFacts(accessor)).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });
    expect(getterCalls).toBe(0);

    let proxyCalls = 0;
    const proxy = new Proxy(validFacts(), {
      get(target, property, receiver) {
        proxyCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(classifyLinuxRootlessPrivilegeFacts(proxy)).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });
    expect(proxyCalls).toBe(0);

    const withSymbol = validFacts();
    Object.defineProperty(withSymbol, Symbol("active"), { enumerable: true, value: true });
    expect(classifyLinuxRootlessPrivilegeFacts(withSymbol)).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });

    let nestedGetterCalls = 0;
    const nestedAccessor = validFacts();
    Object.defineProperty(nestedAccessor.processIdentity.value.uids, "effective", {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return 1000;
      },
    });
    expect(classifyLinuxRootlessPrivilegeFacts(nestedAccessor)).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });
    expect(nestedGetterCalls).toBe(0);
  });

  test("does not obtain a missing schema from Object.prototype", () => {
    Object.defineProperty(Object.prototype, "schema", {
      configurable: true,
      value: {
        enumerable: true,
        value: "runparity.linux_rootless_privilege_facts/v1",
      },
    });
    try {
      const input = validFacts() as Record<string, unknown>;
      delete input["schema"];
      input["extra"] = true;

      expect(classifyLinuxRootlessPrivilegeFacts(input)).toEqual({
        kind: "invalid_snapshot",
        issue: "malformed_or_active_input",
      });
    } finally {
      Reflect.deleteProperty(Object.prototype, "schema");
    }
  });

  test("does not replace an accessor array item with Object.prototype.value", () => {
    let getterCalls = 0;
    const input = validFacts();
    Object.defineProperty(input.processIdentity.value.supplementaryGids, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1000;
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: 1000,
    });
    let result: ReturnType<typeof classifyLinuxRootlessPrivilegeFacts> | undefined;
    try {
      result = classifyLinuxRootlessPrivilegeFacts(input);
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
    }
    expect(result).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });
    expect(getterCalls).toBe(0);
  });

  test("does not fill a sparse decorated array from a polluted descriptor index", () => {
    const input = validFacts();
    const supplementaryGids = new Array(1) as number[];
    Object.defineProperty(supplementaryGids, "decorator", {
      enumerable: true,
      value: "fills the key-count budget",
    });
    input.processIdentity.value.supplementaryGids = supplementaryGids;
    Object.defineProperty(Object.prototype, "0", {
      configurable: true,
      writable: true,
      value: { enumerable: true, value: 1000 },
    });
    let result: ReturnType<typeof classifyLinuxRootlessPrivilegeFacts> | undefined;
    try {
      result = classifyLinuxRootlessPrivilegeFacts(input);
    } finally {
      Reflect.deleteProperty(Object.prototype, "0");
    }

    expect(result).toEqual({
      kind: "invalid_snapshot",
      issue: "malformed_or_active_input",
    });
  });

  test.each([
    ["windows", "amd64"],
    ["linux", "arm64"],
  ])("treats guest platform %s/%s as contradictory", (os, architecture) => {
    const input = validFacts();
    input.guestPlatform.value = { os, architecture };
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: ["platform_not_linux_amd64"],
    });
  });

  test.each([
    ["uids", "real", "process_has_root_uid"],
    ["uids", "effective", "process_has_root_uid"],
    ["uids", "saved", "process_has_root_uid"],
    ["uids", "filesystem", "process_has_root_uid"],
    ["gids", "real", "process_has_root_gid"],
    ["gids", "effective", "process_has_root_gid"],
    ["gids", "saved", "process_has_root_gid"],
    ["gids", "filesystem", "process_has_root_gid"],
  ] as const)("detects root %s.%s", (kind, field, contradiction) => {
    const input = validFacts();
    input.processIdentity.value[kind][field] = 0;

    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: expect.arrayContaining([contradiction]),
    });
  });

  test("detects root supplementary groups", () => {
    const input = validFacts();
    input.processIdentity.value.supplementaryGids.push(0);
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: ["process_has_root_supplementary_gid", "process_gid_not_mapped"],
    });
  });

  test("preserves an observed root contradiction when overflow IDs are missing", () => {
    const input = validFacts();
    input.processIdentity.value.uids.effective = 0;
    input.overflowIds = { state: "missing" } as never;
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: expect.arrayContaining(["process_has_root_uid"]),
      missing: ["overflow_ids"],
    });
  });

  test("keeps map contradictions higher priority than missing evidence", () => {
    const input = validFacts();
    input.userNamespaceMaps.value.uid = [{ insideStart: 2000, outsideStart: 0, length: 1 }];
    input.capabilitySets = { state: "missing" } as never;

    expect(classifyLinuxRootlessPrivilegeFacts(input)).toEqual({
      kind: "contradictory",
      contradictions: ["process_uid_not_mapped", "parent_root_uid_mapped"],
      missing: ["capability_sets"],
    });
  });

  test("requires every process GID to be mapped", () => {
    const input = validFacts();
    input.processIdentity.value.gids.saved = 1002;
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: ["process_gid_not_mapped"],
    });
  });

  test("requires a target-self-to-parent namespace-map view", () => {
    const missingView = validFacts();
    delete (missingView.userNamespaceMaps.value as Record<string, unknown>)["view"];
    const otherReader = validFacts();
    otherReader.userNamespaceMaps.value.view = "other_reader";

    for (const input of [missingView, otherReader]) {
      expect(classifyLinuxRootlessPrivilegeFacts(input)).toEqual({
        kind: "invalid_snapshot",
        issue: "malformed_or_active_input",
      });
    }
  });

  test("requires every supplementary GID to be mapped", () => {
    const input = validFacts();
    input.processIdentity.value.supplementaryGids = [1000, 2000];
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: ["process_gid_not_mapped"],
    });
  });

  test("does not confuse displayed overflow IDs with an unambiguous mapped identity", () => {
    const input = validFacts();
    input.processIdentity.value.uids = {
      real: 65_534,
      effective: 65_534,
      saved: 65_534,
      filesystem: 65_534,
    };
    input.processIdentity.value.gids = { ...input.processIdentity.value.uids };
    input.processIdentity.value.supplementaryGids = [65_534];
    input.userNamespaceMaps.value.uid = [{ insideStart: 65_534, outsideStart: 165_534, length: 1 }];
    input.userNamespaceMaps.value.gid = [{ insideStart: 65_534, outsideStart: 265_534, length: 1 }];

    const result = classifyLinuxRootlessPrivilegeFacts(input);
    expect(result).toEqual({
      kind: "ambiguous",
      ambiguities: ["process_uid_matches_overflow_id", "process_gid_matches_overflow_id"],
      missing: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "ambiguous") {
      expect(Object.isFrozen(result.ambiguities)).toBe(true);
      expect(Object.isFrozen(result.missing)).toBe(true);
    }
  });

  test("keeps contradiction above ambiguity and missing in the fail-closed order", () => {
    const input = validFacts();
    input.processIdentity.value.uids.effective = 0;
    input.overflowIds.value.uid = 0;
    input.capabilitySets = { state: "missing" } as never;
    const result = classifyLinuxRootlessPrivilegeFacts(input);

    expect(result).toMatchObject({
      kind: "contradictory",
      contradictions: expect.arrayContaining(["process_has_root_uid"]),
      missing: ["capability_sets"],
    });
    expect(result).not.toHaveProperty("ambiguities");
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "contradictory") {
      expect(Object.isFrozen(result.contradictions)).toBe(true);
      expect(Object.isFrozen(result.missing)).toBe(true);
    }
  });

  test("detects a parent-root GID mapping", () => {
    const input = validFacts();
    input.userNamespaceMaps.value.gid = [{ insideStart: 1000, outsideStart: 0, length: 2 }];
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: ["parent_root_gid_mapped"],
    });
  });

  test.each([
    ["effective", "effective_capabilities_nonzero"],
    ["permitted", "permitted_capabilities_nonzero"],
    ["inheritable", "inheritable_capabilities_nonzero"],
    ["ambient", "ambient_capabilities_nonzero"],
    ["bounding", "bounding_capabilities_nonzero"],
  ] as const)("rejects a nonzero %s capability mask", (field, contradiction) => {
    const input = validFacts();
    input.capabilitySets.value[field] = "1";
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: [contradiction],
    });
  });

  test("requires no-new-privileges to be enabled", () => {
    const input = validFacts();
    input.noNewPrivileges.value = 0;
    expect(classifyLinuxRootlessPrivilegeFacts(input)).toMatchObject({
      kind: "contradictory",
      contradictions: ["no_new_privileges_disabled"],
    });
  });

  test("accepts the highest mappable Linux UID/GID but rejects the reserved unmapped value", () => {
    const input = validFacts();
    const highestMappable = 0xffff_fffe;
    input.processIdentity.value.uids = {
      real: highestMappable,
      effective: highestMappable,
      saved: highestMappable,
      filesystem: highestMappable,
    };
    input.processIdentity.value.gids = { ...input.processIdentity.value.uids };
    input.processIdentity.value.supplementaryGids = [highestMappable];
    input.userNamespaceMaps.value.uid = [
      { insideStart: highestMappable, outsideStart: 100_000, length: 1 },
    ];
    input.userNamespaceMaps.value.gid = [
      { insideStart: highestMappable, outsideStart: 200_000, length: 1 },
    ];

    expect(classifyLinuxRootlessPrivilegeFacts(input)).toEqual({
      kind: "no_contradiction_in_privilege_subset",
      scope: "linux_rootless_privilege_floor_v1",
    });
  });

  test("rejects malformed masks, duplicate groups, and invalid map ranges", () => {
    const malformed = [
      (() => {
        const value = validFacts();
        value.capabilitySets.value.effective = "A";
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.capabilitySets.value.effective = "00";
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.capabilitySets.value.effective = "1".repeat(17);
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.processIdentity.value.supplementaryGids.push(1000);
        return value;
      })(),
      (() => {
        const value = validFacts();
        const entry = value.userNamespaceMaps.value.uid[0];
        if (entry === undefined) throw new Error("fixture map entry is required");
        entry.length = 0;
        return value;
      })(),
      (() => {
        const value = validFacts();
        const entry = value.userNamespaceMaps.value.uid[0];
        if (entry === undefined) throw new Error("fixture map entry is required");
        Object.assign(entry, {
          insideStart: 0xffff_ffff,
          length: 2,
        });
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.userNamespaceMaps.value.uid.push({
          insideStart: 1000,
          outsideStart: 300_000,
          length: 1,
        });
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.userNamespaceMaps.value.uid.push({
          insideStart: 2000,
          outsideStart: 100_000,
          length: 1,
        });
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.processIdentity.value.uids.real = -1;
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.processIdentity.value.uids.real = 0xffff_ffff;
        return value;
      })(),
      (() => {
        const value = validFacts();
        value.processIdentity.value.supplementaryGids = [0xffff_ffff];
        return value;
      })(),
    ];
    for (const value of malformed) {
      expect(classifyLinuxRootlessPrivilegeFacts(value)).toEqual({
        kind: "invalid_snapshot",
        issue: "malformed_or_active_input",
      });
    }
  });

  test("rejects sparse, decorated, and over-budget arrays", () => {
    const sparse = validFacts();
    sparse.processIdentity.value.supplementaryGids = new Array(2) as number[];
    const decorated = validFacts();
    Object.defineProperty(decorated.processIdentity.value.supplementaryGids, "label", {
      enumerable: true,
      value: "unexpected",
    });
    const tooManyGroups = validFacts();
    tooManyGroups.processIdentity.value.supplementaryGids = Array.from(
      { length: 257 },
      (_, index) => index + 1,
    );
    const tooManyMaps = validFacts();
    tooManyMaps.userNamespaceMaps.value.uid = Array.from({ length: 65 }, (_, index) => ({
      insideStart: index,
      outsideStart: 100_000 + index,
      length: 1,
    }));

    for (const value of [sparse, decorated, tooManyGroups, tooManyMaps]) {
      expect(classifyLinuxRootlessPrivilegeFacts(value)).toEqual({
        kind: "invalid_snapshot",
        issue: "malformed_or_active_input",
      });
    }
  });

  test("snapshots input, freezes nested output, and classifies deterministically", () => {
    const input = validFacts();
    const first = classifyLinuxRootlessPrivilegeFacts(input);
    input.processIdentity.value.uids.effective = 0;
    input.capabilitySets.value.bounding = "1";
    const second = classifyLinuxRootlessPrivilegeFacts(validFacts());

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const missing = validFacts();
    missing.guestPlatform = { state: "missing" } as never;
    missing.noNewPrivileges = { state: "missing" } as never;
    const missingResult = classifyLinuxRootlessPrivilegeFacts(missing);
    expect(missingResult).toEqual({
      kind: "missing",
      missing: ["guest_platform", "no_new_privileges"],
    });
    if (missingResult.kind === "missing") expect(Object.isFrozen(missingResult.missing)).toBe(true);
  });
});
