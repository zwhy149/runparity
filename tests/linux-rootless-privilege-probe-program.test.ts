import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isProxy } from "node:util/types";
import { afterEach, describe, expect, test } from "vitest";
import { decodeLinuxRootlessPrivilegeProbeBundle } from "../src/oci/linux-rootless-privilege-probe-bundle.js";
import { readBoundedLinuxGuestPrivilegeSource } from "../src/oci/linux-rootless-privilege-probe-node-runtime.js";
import {
  assembleFixedLinuxGuestPrivilegeProbe,
  type FixedLinuxGuestPrivilegeProbeProgramResult,
  type FixedLinuxGuestPrivilegeProbeRuntime,
  type FixedLinuxGuestPrivilegeSourceSpec,
  renderFixedLinuxGuestPrivilegeProbeResult,
} from "../src/oci/linux-rootless-privilege-probe-program.js";

const sourceBytes = new Map([
  ["proc_self_status", Buffer.from("Name:\tprobe\nUid:\t1000\t1000\t1000\t1000\n")],
  ["proc_self_uid_map", Buffer.from("1000 100000 1\n")],
  ["proc_self_gid_map", Buffer.from("1000 200000 1\n")],
  ["overflow_uid", Buffer.from("65534\n")],
  ["overflow_gid", Buffer.from("65534\n")],
]);
const arrayBufferResize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")?.value;

const expectedSources = [
  { id: "proc_self_status", absolutePath: "/proc/self/status", maximumBytes: 64 * 1024 },
  { id: "proc_self_uid_map", absolutePath: "/proc/self/uid_map", maximumBytes: 8 * 1024 },
  { id: "proc_self_gid_map", absolutePath: "/proc/self/gid_map", maximumBytes: 8 * 1024 },
  { id: "overflow_uid", absolutePath: "/proc/sys/kernel/overflowuid", maximumBytes: 32 },
  { id: "overflow_gid", absolutePath: "/proc/sys/kernel/overflowgid", maximumBytes: 32 },
] as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeRuntime(
  response: (
    source: FixedLinuxGuestPrivilegeSourceSpec,
  ) => ReturnType<FixedLinuxGuestPrivilegeProbeRuntime["read"]> = (source) => ({
    kind: "observed",
    bytes: sourceBytes.get(source.id) as Uint8Array,
  }),
  platform = "linux",
  architecture = "x64",
) {
  const calls: FixedLinuxGuestPrivilegeSourceSpec[] = [];
  const runtime: FixedLinuxGuestPrivilegeProbeRuntime = {
    platform,
    architecture,
    read(source) {
      calls.push(source);
      return response(source);
    },
  };
  return { runtime, calls };
}

describe("fixed Linux guest privilege probe program", () => {
  test("assembles the exact frozen raw bundle from fixed sources in fixed order", () => {
    const { runtime, calls } = makeRuntime();

    const result = assembleFixedLinuxGuestPrivilegeProbe([], runtime);

    expect(calls).toEqual(expectedSources);
    expect(calls.every((source) => Object.isFrozen(source))).toBe(true);
    expect(result).toEqual({
      kind: "assembled_unverified_bundle",
      bundle: {
        schema: "runparity.linux_rootless_privilege_probe_bundle/v1",
        captureView: "guest_probe_process_self",
        platform: { state: "observed", text: "os=linux\narchitecture=amd64\n" },
        procSelfStatus: {
          state: "observed",
          text: "Name:\tprobe\nUid:\t1000\t1000\t1000\t1000\n",
        },
        procSelfUidMap: { state: "observed", text: "1000 100000 1\n" },
        procSelfGidMap: { state: "observed", text: "1000 200000 1\n" },
        overflowUid: { state: "observed", text: "65534\n" },
        overflowGid: { state: "observed", text: "65534\n" },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind !== "assembled_unverified_bundle") return;
    expect(Object.isFrozen(result.bundle)).toBe(true);
    for (const artifact of [
      result.bundle.platform,
      result.bundle.procSelfStatus,
      result.bundle.procSelfUidMap,
      result.bundle.procSelfGidMap,
      result.bundle.overflowUid,
      result.bundle.overflowGid,
    ]) {
      expect(Object.isFrozen(artifact)).toBe(true);
    }
    expect(JSON.stringify(result)).not.toMatch(
      /qualification|receipt|authorization|ledger|verdict|proof|session_bound/iu,
    );
  });

  test("preserves explicit missing sources and an observed empty map", () => {
    const { runtime } = makeRuntime((source) => {
      if (source.id === "proc_self_status" || source.id === "overflow_gid") {
        return { kind: "missing" };
      }
      if (source.id === "proc_self_uid_map") {
        return { kind: "observed", bytes: new Uint8Array() };
      }
      return { kind: "observed", bytes: sourceBytes.get(source.id) as Uint8Array };
    });

    const result = assembleFixedLinuxGuestPrivilegeProbe([], runtime);

    expect(result).toMatchObject({
      kind: "assembled_unverified_bundle",
      bundle: {
        procSelfStatus: { state: "missing" },
        procSelfUidMap: { state: "observed", text: "" },
        overflowGid: { state: "missing" },
      },
    });
  });

  test.each([
    [
      "reader failure",
      () => ({ kind: "failed" as const }),
      "source_read_failed",
      "RP_PROBE_SOURCE_READ_FAILED\n",
    ],
    [
      "source byte overflow",
      (source: FixedLinuxGuestPrivilegeSourceSpec) => ({
        kind: "observed" as const,
        bytes: new Uint8Array(source.maximumBytes + 1),
      }),
      "source_limit_exceeded",
      "RP_PROBE_SOURCE_LIMIT_EXCEEDED\n",
    ],
    [
      "invalid UTF-8",
      () => ({ kind: "observed" as const, bytes: Uint8Array.from([0xc3, 0x28]) }),
      "invalid_utf8",
      "RP_PROBE_INVALID_UTF8\n",
    ],
  ] as const)(
    "fails the whole probe without partial output on %s",
    (_name, response, reason, stderr) => {
      const { runtime, calls } = makeRuntime((source) =>
        source.id === "proc_self_uid_map"
          ? response(source)
          : { kind: "observed", bytes: sourceBytes.get(source.id) as Uint8Array },
      );

      const result = assembleFixedLinuxGuestPrivilegeProbe([], runtime);

      expect(result).toEqual({ kind: "probe_failed", reason });
      expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
      expect(Object.isFrozen(result)).toBe(true);
      expect("bundle" in result).toBe(false);
      expect(calls.at(-1)?.id).toBe("proc_self_uid_map");
      expect(renderFixedLinuxGuestPrivilegeProbeResult(result)).toEqual({
        exitCode: 74,
        stdout: "",
        stderr,
      });
    },
  );

  test.each([
    ["win32", "x64"],
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["linux", "amd64"],
  ])("refuses unsupported runtime %s/%s before reading a source", (platform, architecture) => {
    const { runtime, calls } = makeRuntime(undefined, platform, architecture);
    expect(assembleFixedLinuxGuestPrivilegeProbe([], runtime)).toEqual({
      kind: "probe_failed",
      reason: "unsupported_runtime",
    });
    expect(calls).toEqual([]);
  });

  test("refuses any program argument before inspecting runtime or reading a source", () => {
    let getterCalls = 0;
    const runtime = Object.defineProperty({}, "platform", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "linux";
      },
    });

    expect(assembleFixedLinuxGuestPrivilegeProbe(["--unexpected"], runtime)).toEqual({
      kind: "probe_failed",
      reason: "invalid_invocation",
    });
    expect(getterCalls).toBe(0);
  });

  test("rejects active runtime records without invoking getters or proxied readers", () => {
    let getterCalls = 0;
    let proxyCalls = 0;
    const accessor = {
      platform: "linux",
      architecture: "x64",
      get read() {
        getterCalls += 1;
        return () => ({ kind: "missing" });
      },
    };
    const { runtime } = makeRuntime();
    const proxiedRead = new Proxy(runtime.read, {
      apply() {
        proxyCalls += 1;
        return { kind: "missing" };
      },
    });

    for (const candidate of [accessor, { ...runtime, read: proxiedRead }]) {
      expect(assembleFixedLinuxGuestPrivilegeProbe([], candidate)).toEqual({
        kind: "probe_failed",
        reason: "invalid_runtime",
      });
    }
    expect(getterCalls).toBe(0);
    expect(proxyCalls).toBe(0);
    expect(isProxy(proxiedRead)).toBe(true);
  });

  test("rejects active source responses and byte views without invoking caller code", () => {
    let responseGetterCalls = 0;
    let byteProxyCalls = 0;
    let byteViewGetterCalls = 0;
    const responseAccessor = Object.defineProperty({ kind: "observed" }, "bytes", {
      enumerable: true,
      get() {
        responseGetterCalls += 1;
        return Buffer.from("hidden");
      },
    });
    const byteProxy = new Proxy(Uint8Array.from([0x31]), {
      get() {
        byteProxyCalls += 1;
        throw new Error("must remain inert");
      },
    });
    const decoratedByteLength = Object.defineProperty(Uint8Array.from([0x31]), "byteLength", {
      configurable: true,
      get() {
        byteViewGetterCalls += 1;
        throw new Error("must remain inert");
      },
    });
    const decoratedLength = Object.defineProperty(Uint8Array.from([0x31]), "length", {
      configurable: true,
      get() {
        byteViewGetterCalls += 1;
        throw new Error("must remain inert");
      },
    });

    for (const response of [
      responseAccessor,
      { kind: "observed", bytes: byteProxy },
      { kind: "observed", bytes: decoratedByteLength },
      { kind: "observed", bytes: decoratedLength },
    ]) {
      const { runtime } = makeRuntime(() => response as never);
      expect(assembleFixedLinuxGuestPrivilegeProbe([], runtime)).toEqual({
        kind: "probe_failed",
        reason: "invalid_source_response",
      });
    }
    expect(responseGetterCalls).toBe(0);
    expect(byteProxyCalls).toBe(0);
    expect(byteViewGetterCalls).toBe(0);
  });

  test("rejects shared or detached byte views before producing a torn or false-empty snapshot", () => {
    const sharedBacking = new SharedArrayBuffer(1);
    new Uint8Array(sharedBacking)[0] = 0x31;
    const sharedViews = [new Uint8Array(sharedBacking), Buffer.from(sharedBacking)];
    const detachedView = Uint8Array.from([0x31]);
    structuredClone(detachedView.buffer, { transfer: [detachedView.buffer] });

    for (const bytes of [...sharedViews, detachedView]) {
      const { runtime } = makeRuntime(() => ({ kind: "observed", bytes }));
      expect(assembleFixedLinuxGuestPrivilegeProbe([], runtime)).toEqual({
        kind: "probe_failed",
        reason: "invalid_source_response",
      });
    }
  });

  test.runIf(typeof arrayBufferResize === "function")(
    "rejects an out-of-bounds resizable-buffer view instead of recording a false empty source",
    () => {
      if (typeof arrayBufferResize !== "function") throw new Error("resizable buffers unavailable");
      const backing = Reflect.construct(ArrayBuffer, [1, { maxByteLength: 2 }]) as ArrayBuffer;
      const outOfBoundsView = new Uint8Array(backing, 0, 1);
      Reflect.apply(arrayBufferResize, backing, [0]);
      const { runtime } = makeRuntime(() => ({ kind: "observed", bytes: outOfBoundsView }));

      expect(assembleFixedLinuxGuestPrivilegeProbe([], runtime)).toEqual({
        kind: "probe_failed",
        reason: "invalid_source_response",
      });
    },
  );

  test("rejects a revoked or decorated argv array before touching runtime", () => {
    let runtimeGetterCalls = 0;
    const runtime = Object.defineProperty({}, "platform", {
      enumerable: true,
      get() {
        runtimeGetterCalls += 1;
        return "linux";
      },
    });
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    const decorated: unknown[] = [];
    Object.defineProperty(decorated, Symbol("extra"), { enumerable: true, value: true });

    for (const argv of [revoked.proxy, decorated]) {
      expect(assembleFixedLinuxGuestPrivilegeProbe(argv, runtime)).toEqual({
        kind: "probe_failed",
        reason: "invalid_invocation",
      });
    }
    expect(runtimeGetterCalls).toBe(0);
  });

  test("produces a bundle accepted by the decoder without invoking a judgment automatically", () => {
    const { runtime } = makeRuntime((source) => {
      if (source.id === "proc_self_status") {
        return {
          kind: "observed",
          bytes: Buffer.from(
            [
              "Uid:\t1000\t1000\t1000\t1000",
              "Gid:\t1000\t1000\t1000\t1000",
              "Groups:\t1000",
              "CapInh:\t0000000000000000",
              "CapPrm:\t0000000000000000",
              "CapEff:\t0000000000000000",
              "CapBnd:\t0000000000000000",
              "CapAmb:\t0000000000000000",
              "NoNewPrivs:\t1",
              "",
            ].join("\n"),
          ),
        };
      }
      return { kind: "observed", bytes: sourceBytes.get(source.id) as Uint8Array };
    });
    const result = assembleFixedLinuxGuestPrivilegeProbe([], runtime);
    expect(result.kind).toBe("assembled_unverified_bundle");
    if (result.kind !== "assembled_unverified_bundle") return;

    expect(decodeLinuxRootlessPrivilegeProbeBundle(result.bundle)).toMatchObject({
      kind: "decoded_unqualified_facts",
      sourceAssurance: "caller_supplied_unverified",
    });
  });

  test("renders only stable one-line JSON or fixed ASCII failure text", () => {
    const { runtime } = makeRuntime();
    const success = renderFixedLinuxGuestPrivilegeProbeResult(
      assembleFixedLinuxGuestPrivilegeProbe([], runtime),
    );
    const failure = renderFixedLinuxGuestPrivilegeProbeResult(
      assembleFixedLinuxGuestPrivilegeProbe(["unexpected"], runtime),
    );

    expect(success.exitCode).toBe(0);
    expect(success.stderr).toBe("");
    expect(success.stdout.endsWith("\n")).toBe(true);
    expect(success.stdout.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(success.stdout)).toMatchObject({
      schema: "runparity.linux_rootless_privilege_probe_bundle/v1",
      captureView: "guest_probe_process_self",
    });
    expect(failure).toEqual({
      exitCode: 64,
      stdout: "",
      stderr: "RP_PROBE_INVALID_INVOCATION\n",
    });
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  test("suppresses a forged over-budget rendered bundle with fixed failure text", () => {
    const { runtime } = makeRuntime();
    const result = assembleFixedLinuxGuestPrivilegeProbe([], runtime);
    expect(result.kind).toBe("assembled_unverified_bundle");
    if (result.kind !== "assembled_unverified_bundle") return;
    const forged = {
      kind: "assembled_unverified_bundle",
      bundle: {
        ...result.bundle,
        procSelfStatus: { state: "observed", text: "\u0000".repeat(100_000) },
      },
    } as unknown as FixedLinuxGuestPrivilegeProbeProgramResult;

    expect(renderFixedLinuxGuestPrivilegeProbeResult(forged)).toEqual({
      exitCode: 74,
      stdout: "",
      stderr: "RP_PROBE_OUTPUT_LIMIT_EXCEEDED\n",
    });
  });

  test("the Node source adapter reads at the exact cap and owns the returned bytes", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "runparity-fixed-probe-"));
    temporaryDirectories.push(directory);
    const sourcePath = resolve(directory, "source");
    writeFileSync(sourcePath, "12345678", "utf8");
    const source = Object.freeze({
      id: "proc_self_status" as const,
      absolutePath: sourcePath,
      maximumBytes: 8,
    });

    const result = readBoundedLinuxGuestPrivilegeSource(source);
    writeFileSync(sourcePath, "changed!", "utf8");

    expect(result).toMatchObject({ kind: "observed" });
    if (result.kind !== "observed") return;
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("12345678");
  });

  test("the Node source adapter distinguishes missing, over-limit, and other I/O failure", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "runparity-fixed-probe-"));
    temporaryDirectories.push(directory);
    const missingPath = resolve(directory, "missing");
    const oversizedPath = resolve(directory, "oversized");
    const directoryPath = resolve(directory, "directory");
    writeFileSync(oversizedPath, "123456789", "utf8");
    mkdirSync(directoryPath);
    const source = (absolutePath: string) =>
      Object.freeze({
        id: "proc_self_status" as const,
        absolutePath,
        maximumBytes: 8,
      });

    expect(readBoundedLinuxGuestPrivilegeSource(source(missingPath))).toEqual({ kind: "missing" });
    expect(readBoundedLinuxGuestPrivilegeSource(source(oversizedPath))).toEqual({
      kind: "limit_exceeded",
    });
    expect(readBoundedLinuxGuestPrivilegeSource(source(directoryPath))).toEqual({ kind: "failed" });
  });
});
