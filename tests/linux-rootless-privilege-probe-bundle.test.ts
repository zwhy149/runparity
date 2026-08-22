import { describe, expect, test } from "vitest";
import { classifyLinuxRootlessPrivilegeFacts } from "../src/oci/linux-rootless-privilege-policy.js";
import {
  decodeLinuxRootlessPrivilegeProbeBundle,
  type LinuxRootlessPrivilegeProbeBundleV1,
} from "../src/oci/linux-rootless-privilege-probe-bundle.js";

const SCHEMA = "runparity.linux_rootless_privilege_probe_bundle/v1" as const;

function observed(text: string) {
  return { state: "observed" as const, text };
}

function missing() {
  return { state: "missing" as const };
}

function statusText(overrides: Readonly<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    Uid: "1000\t1000\t1000\t1000",
    Gid: "1000\t1000\t1000\t1000",
    Groups: "1000 1001",
    CapInh: "0000000000000000",
    CapPrm: "0000000000000000",
    CapEff: "0000000000000000",
    CapBnd: "0000000000000000",
    CapAmb: "0000000000000000",
    NoNewPrivs: "1",
    ...overrides,
  };
  return [
    "Name:\tfixture-process-name",
    ...Object.entries(fields).map(([key, value]) => `${key}:\t${value}`),
  ]
    .join("\n")
    .concat("\n");
}

function validBundle() {
  return {
    schema: SCHEMA,
    captureView: "guest_probe_process_self" as const,
    platform: observed("os=linux\narchitecture=amd64\n"),
    procSelfStatus: observed(statusText()),
    procSelfUidMap: observed("1000 100000 1\n"),
    procSelfGidMap: observed("1000 200000 2\n"),
    overflowUid: observed("65534\n"),
    overflowGid: observed("65534\n"),
  };
}

function decodedFacts(bundle: unknown) {
  const result = decodeLinuxRootlessPrivilegeProbeBundle(bundle);
  expect(result.kind).toBe("decoded_unqualified_facts");
  if (result.kind !== "decoded_unqualified_facts") throw new Error("expected decoded facts");
  return result.facts;
}

describe("Linux rootless privilege probe bundle decoder", () => {
  test("decodes a complete caller-supplied bundle into exact unqualified facts", () => {
    const producerContract: LinuxRootlessPrivilegeProbeBundleV1 = validBundle();
    const result = decodeLinuxRootlessPrivilegeProbeBundle(producerContract);

    expect(result).toEqual({
      kind: "decoded_unqualified_facts",
      sourceAssurance: "caller_supplied_unverified",
      facts: {
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
      },
    });
    expect(Object.keys(result).sort()).toEqual(["facts", "kind", "sourceAssurance"]);
    for (const forbidden of [
      "complete",
      "qualified",
      "qualification",
      "readiness",
      "receipt",
      "authorization",
      "ledger",
      "verdict",
      "proof",
    ]) {
      expect(result).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(result)).not.toContain("fixture-process-name");
  });

  test("preserves contradictions for the existing pure policy to judge", () => {
    const bundle = validBundle();
    bundle.procSelfStatus = observed(
      statusText({
        Uid: "0\t0\t0\t0",
        Gid: "0\t0\t0\t0",
        Groups: "0",
        CapEff: "0000000000000001",
        NoNewPrivs: "0",
      }),
    );

    const judgment = classifyLinuxRootlessPrivilegeFacts(decodedFacts(bundle));

    expect(judgment).toMatchObject({
      kind: "contradictory",
      contradictions: expect.arrayContaining([
        "process_has_root_uid",
        "process_has_root_gid",
        "process_has_root_supplementary_gid",
        "effective_capabilities_nonzero",
        "no_new_privileges_disabled",
      ]),
    });
  });

  test("preserves overflow ambiguity instead of manufacturing a clean identity", () => {
    const bundle = validBundle();
    bundle.procSelfStatus = observed(
      statusText({
        Uid: "65534\t65534\t65534\t65534",
        Gid: "65534\t65534\t65534\t65534",
        Groups: "65534",
      }),
    );
    bundle.procSelfUidMap = observed("65534 165534 1\n");
    bundle.procSelfGidMap = observed("65534 265534 1\n");

    expect(classifyLinuxRootlessPrivilegeFacts(decodedFacts(bundle))).toEqual({
      kind: "ambiguous",
      ambiguities: ["process_uid_matches_overflow_id", "process_gid_matches_overflow_id"],
      missing: [],
    });
  });

  test.each([
    ["platform", ["guestPlatform"]],
    ["procSelfStatus", ["processIdentity", "capabilitySets", "noNewPrivileges"]],
    ["procSelfUidMap", ["userNamespaceMaps"]],
    ["procSelfGidMap", ["userNamespaceMaps"]],
    ["overflowUid", ["overflowIds"]],
    ["overflowGid", ["overflowIds"]],
  ] as const)("maps an explicit missing %s artifact to stable fact groups", (slot, groups) => {
    const bundle = validBundle();
    bundle[slot] = missing() as never;
    const facts = decodedFacts(bundle) as unknown as Record<string, { state: string }>;

    for (const group of groups) expect(facts[group]?.state).toBe("missing");
  });

  test("keeps partially available map and overflow pairs missing as a whole", () => {
    const bundle = validBundle();
    bundle.procSelfUidMap = missing() as never;
    bundle.overflowGid = missing() as never;

    const facts = decodedFacts(bundle);

    expect(facts.userNamespaceMaps).toEqual({ state: "missing" });
    expect(facts.overflowIds).toEqual({ state: "missing" });
  });

  test("does not let a missing paired source hide a malformed observed source", () => {
    const malformedMapPair = validBundle();
    malformedMapPair.procSelfUidMap = missing() as never;
    malformedMapPair.procSelfGidMap = observed("not a map\n");
    const malformedOverflowPair = validBundle();
    malformedOverflowPair.overflowUid = missing() as never;
    malformedOverflowPair.overflowGid = observed("not-an-id\n");

    for (const bundle of [malformedMapPair, malformedOverflowPair]) {
      const result = decodeLinuxRootlessPrivilegeProbeBundle(bundle);
      expect(result).toEqual({ kind: "invalid_bundle", issue: "malformed_artifact" });
      expect(Object.keys(result).sort()).toEqual(["issue", "kind"]);
      expect(Object.isFrozen(result)).toBe(true);
      expect("facts" in result).toBe(false);
    }
  });

  test("preserves empty observed maps so the policy can report unmapped identities", () => {
    const bundle = validBundle();
    bundle.procSelfUidMap = observed("");
    bundle.procSelfGidMap = observed("");

    const facts = decodedFacts(bundle);

    expect(facts.userNamespaceMaps).toEqual({
      state: "observed",
      value: { view: "target_self_parent", uid: [], gid: [] },
    });
    expect(classifyLinuxRootlessPrivilegeFacts(facts)).toEqual({
      kind: "contradictory",
      contradictions: ["process_uid_not_mapped", "process_gid_not_mapped"],
      missing: [],
    });
  });

  test("marks an incomplete status fact group missing but rejects malformed observed lines", () => {
    const incomplete = validBundle();
    incomplete.procSelfStatus = observed(statusText().replace(/^CapAmb:.*\n/mu, ""));
    expect(decodedFacts(incomplete).capabilitySets).toEqual({ state: "missing" });

    const duplicate = validBundle();
    duplicate.procSelfStatus = observed(`${statusText()}Uid:\t1000 1000 1000 1000\n`);
    expect(decodeLinuxRootlessPrivilegeProbeBundle(duplicate)).toEqual({
      kind: "invalid_bundle",
      issue: "malformed_artifact",
    });

    const malformed = validBundle();
    malformed.procSelfStatus = observed(statusText({ Uid: "1000 1000 1000" }));
    expect(decodeLinuxRootlessPrivilegeProbeBundle(malformed)).toEqual({
      kind: "invalid_bundle",
      issue: "malformed_artifact",
    });
  });

  test.each([
    [
      "leading zero",
      (bundle: ReturnType<typeof validBundle>) => (bundle.overflowUid = observed("065534\n")),
    ],
    [
      "plus sign",
      (bundle: ReturnType<typeof validBundle>) => (bundle.overflowUid = observed("+65534\n")),
    ],
    [
      "negative",
      (bundle: ReturnType<typeof validBundle>) => (bundle.overflowUid = observed("-1\n")),
    ],
    [
      "decimal",
      (bundle: ReturnType<typeof validBundle>) => (bundle.overflowUid = observed("1.5\n")),
    ],
    [
      "reserved id",
      (bundle: ReturnType<typeof validBundle>) => (bundle.overflowUid = observed("4294967295\n")),
    ],
    [
      "map overflow",
      (bundle: ReturnType<typeof validBundle>) =>
        (bundle.procSelfUidMap = observed("4294967294 1000 2\n")),
    ],
  ])("rejects non-canonical or unsafe decimal input: %s", (_name, mutate) => {
    const bundle = validBundle();
    mutate(bundle);
    expect(decodeLinuxRootlessPrivilegeProbeBundle(bundle)).toEqual({
      kind: "invalid_bundle",
      issue: "malformed_artifact",
    });
  });

  test("normalizes capability masks and rejects non-hex or wider-than-64-bit masks", () => {
    const normalized = validBundle();
    normalized.procSelfStatus = observed(statusText({ CapEff: "00000000000000af" }));
    expect(decodedFacts(normalized).capabilitySets).toMatchObject({
      state: "observed",
      value: { effective: "af" },
    });

    for (const mask of ["1", "00000000000000AF", "0x00000000000001", "10000000000000000"]) {
      const invalid = validBundle();
      invalid.procSelfStatus = observed(statusText({ CapEff: mask }));
      expect(decodeLinuxRootlessPrivilegeProbeBundle(invalid)).toEqual({
        kind: "invalid_bundle",
        issue: "malformed_artifact",
      });
    }
  });

  test.each([
    ["highest single ID", "4294967294 4294967294 1\n"],
    ["full mappable range", "0 0 4294967295\n"],
    ["adjacent ranges", "0 1000 1\n1 1001 1\n"],
  ])("accepts a canonical map boundary: %s", (_name, text) => {
    const bundle = validBundle();
    bundle.procSelfUidMap = observed(text);
    expect(decodeLinuxRootlessPrivilegeProbeBundle(bundle).kind).toBe("decoded_unqualified_facts");
  });

  test.each([
    ["extra token", "1000 100000 1 extra\n"],
    ["zero length", "1000 100000 0\n"],
    ["inside overlap", "1000 100000 2\n1001 200000 1\n"],
    ["outside overlap", "1000 100000 1\n2000 100000 1\n"],
    [
      "too many entries",
      Array.from({ length: 65 }, (_, index) => `${index} ${100000 + index} 1`)
        .join("\n")
        .concat("\n"),
    ],
  ])("rejects malformed uid maps: %s", (_name, text) => {
    const bundle = validBundle();
    bundle.procSelfUidMap = observed(text);
    expect(decodeLinuxRootlessPrivilegeProbeBundle(bundle)).toEqual({
      kind: "invalid_bundle",
      issue: "malformed_artifact",
    });
  });

  test.each([
    ["carriage return", () => statusText().replace("\n", "\r\n")],
    ["NUL", () => statusText().replace("fixture", "fix\u0000ture")],
    ["BOM", () => `\ufeff${statusText()}`],
    ["non-ASCII", () => statusText().replace("fixture", "探针")],
    ["bidi control", () => statusText().replace("fixture", "fix\u202eture")],
    ["non-breaking space", () => statusText().replace("1000\t1000", "1000\u00a01000")],
    ["fullwidth digit", () => statusText({ Uid: "１０００ 1000 1000 1000" })],
    ["line too long", () => `Ignored:\t${"x".repeat(4097)}\n${statusText()}`],
    ["too many lines", () => `${"Ignored:\tx\n".repeat(512)}${statusText()}`],
    ["byte budget", () => `Ignored:\t${"x".repeat(64 * 1024)}\n`],
  ])("rejects unsafe or over-budget status text: %s", (_name, makeText) => {
    const bundle = validBundle();
    bundle.procSelfStatus = observed(makeText());
    expect(decodeLinuxRootlessPrivilegeProbeBundle(bundle)).toEqual({
      kind: "invalid_bundle",
      issue: "malformed_artifact",
    });
  });

  test("rejects active and decorated input without invoking caller code", () => {
    let getterCalls = 0;
    let proxyCalls = 0;
    const accessor = validBundle() as Record<string, unknown>;
    Object.defineProperty(accessor, "schema", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return SCHEMA;
      },
    });
    const proxy = new Proxy(validBundle(), {
      get() {
        proxyCalls += 1;
        throw new Error("must remain inert");
      },
      ownKeys() {
        proxyCalls += 1;
        throw new Error("must remain inert");
      },
    });
    const decorated = validBundle();
    Object.defineProperty(decorated, Symbol("extra"), { enumerable: true, value: true });

    for (const candidate of [accessor, proxy, decorated]) {
      expect(decodeLinuxRootlessPrivilegeProbeBundle(candidate)).toEqual({
        kind: "invalid_bundle",
        issue: "malformed_or_active_input",
      });
    }
    expect(getterCalls).toBe(0);
    expect(proxyCalls).toBe(0);
  });

  test("rejects active nested artifacts without invoking their getters or proxy traps", () => {
    let getterCalls = 0;
    let proxyCalls = 0;
    const accessorBundle = validBundle();
    Object.defineProperty(accessorBundle.platform, "text", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "os=linux\narchitecture=amd64\n";
      },
    });
    const proxyBundle = validBundle();
    proxyBundle.platform = new Proxy(proxyBundle.platform, {
      get() {
        proxyCalls += 1;
        throw new Error("must remain inert");
      },
      ownKeys() {
        proxyCalls += 1;
        throw new Error("must remain inert");
      },
    });
    const revokedBundle = validBundle();
    const revoked = Proxy.revocable(revokedBundle.platform, {});
    revoked.revoke();
    revokedBundle.platform = revoked.proxy;

    for (const bundle of [accessorBundle, proxyBundle, revokedBundle]) {
      expect(decodeLinuxRootlessPrivilegeProbeBundle(bundle)).toEqual({
        kind: "invalid_bundle",
        issue: "malformed_or_active_input",
      });
    }
    expect(getterCalls).toBe(0);
    expect(proxyCalls).toBe(0);
  });

  test("owns and deeply freezes decoded facts independently of later input mutation", () => {
    const bundle = validBundle();
    const first = decodeLinuxRootlessPrivilegeProbeBundle(bundle);
    bundle.procSelfStatus.text = statusText({ Uid: "0\t0\t0\t0" });
    const second = decodeLinuxRootlessPrivilegeProbeBundle(validBundle());

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    if (first.kind === "decoded_unqualified_facts") {
      expect(Object.isFrozen(first.facts)).toBe(true);
      if (first.facts.processIdentity.state === "observed") {
        expect(Object.isFrozen(first.facts.processIdentity.value)).toBe(true);
        expect(Object.isFrozen(first.facts.processIdentity.value.supplementaryGids)).toBe(true);
      }
      if (first.facts.userNamespaceMaps.state === "observed") {
        expect(Object.isFrozen(first.facts.userNamespaceMaps.value.uid)).toBe(true);
        expect(Object.isFrozen(first.facts.userNamespaceMaps.value.uid[0])).toBe(true);
      }
    }
  });

  test("keeps an all-missing decoded fact graph exact and deeply frozen", () => {
    const bundle = validBundle();
    bundle.platform = missing() as never;
    bundle.procSelfStatus = missing() as never;
    bundle.procSelfUidMap = missing() as never;
    bundle.procSelfGidMap = missing() as never;
    bundle.overflowUid = missing() as never;
    bundle.overflowGid = missing() as never;

    const result = decodeLinuxRootlessPrivilegeProbeBundle(bundle);

    expect(result.kind).toBe("decoded_unqualified_facts");
    if (result.kind !== "decoded_unqualified_facts") return;
    expect(result.sourceAssurance).toBe("caller_supplied_unverified");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.facts)).toBe(true);
    for (const [key, fact] of Object.entries(result.facts)) {
      if (key === "schema") continue;
      expect(Object.isFrozen(fact), key).toBe(true);
      expect(fact).toEqual({ state: "missing" });
    }
  });

  test("keeps every successfully decoded fact graph inside the policy input language", () => {
    const maximumGroupsBundle = validBundle();
    maximumGroupsBundle.procSelfStatus = observed(
      statusText({
        Groups: Array.from({ length: 256 }, (_, index) => String(index)).join(" "),
        CapEff: "ffffffffffffffff",
      }),
    );
    const maximumMapsBundle = validBundle();
    maximumMapsBundle.procSelfUidMap = observed(
      Array.from({ length: 64 }, (_, index) => `${index} ${100000 + index} 1`)
        .join("\n")
        .concat("\n"),
    );
    const variants = [validBundle(), maximumGroupsBundle, maximumMapsBundle];

    for (const bundle of variants) {
      const result = decodeLinuxRootlessPrivilegeProbeBundle(bundle);
      expect(result.kind).toBe("decoded_unqualified_facts");
      if (result.kind !== "decoded_unqualified_facts") continue;
      expect(classifyLinuxRootlessPrivilegeFacts(result.facts).kind).not.toBe("invalid_snapshot");
    }
  });
});
