import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const artifactPath = resolve(projectRoot, "dist", "linux-rootless-privilege-probe.js");

function staticModuleSpecifiers(source) {
  return [
    ...source.matchAll(/^\s*import(?:\s+[^"']+\s+from)?\s+["']([^"']+)["'];?\s*$/gmu),
    ...source.matchAll(/^\s*export\s+[^"'\r\n]+?\s+from\s+["']([^"']+)["'];?\s*$/gmu),
  ]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((match) => match[1]);
}

test("the fixed probe is built as a private, syntax-valid artifact", () => {
  const packageManifest = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  const artifact = readFileSync(artifactPath, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", artifactPath], { encoding: "utf8" });

  assert.equal(packageManifest.bin.runparity, "dist/cli.js");
  assert.deepEqual(Object.keys(packageManifest.bin), ["runparity"]);
  assert.match(artifact, /^#!\/usr\/bin\/env node\n/u);
  assert.deepEqual(
    [
      ...new Set(
        staticModuleSpecifiers(artifact).map((specifier) => specifier.replace(/^node:/u, "")),
      ),
    ].sort(),
    ["fs", "path", "url", "util/types"],
  );
  assert.deepEqual(staticModuleSpecifiers('import { spawn } from "node:child_process";'), [
    "node:child_process",
  ]);
  assert.deepEqual(staticModuleSpecifiers('import { spawn } from "child_process";'), [
    "child_process",
  ]);
  assert.deepEqual(staticModuleSpecifiers('export { spawn } from "node:child_process";'), [
    "node:child_process",
  ]);
  assert.doesNotMatch(
    artifact,
    /linux-rootless-preflight|linux-rootless-privilege-policy|decodeLinuxRootlessPrivilegeProbeBundle/iu,
  );
  assert.doesNotMatch(artifact, /\b(?:import\s*\(|require\s*\()/u);
  assert.doesNotMatch(artifact, /process\.(?:env|cwd)|process\.stdin/iu);
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("the artifact rejects arguments before platform or source work", () => {
  const result = spawnSync(process.execPath, [artifactPath, "--unexpected"], {
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(result.status, 64);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "RP_PROBE_INVALID_INVOCATION\n");
});

test("importing the private artifact has no output or process-exit side effect", () => {
  const artifactUrl = pathToFileURL(artifactPath).href;
  const program = [
    `await import(${JSON.stringify(artifactUrl)})`,
    'process.stdout.write("IMPORT_OK\\n")',
  ].join(";");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "IMPORT_OK\n");
  assert.equal(result.stderr, "");
});

test("direct execution through a directory link preserves the process contract", () => {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "runparity-probe-entry-"));
  const linkedDirectory = resolve(temporaryDirectory, "linked-dist");
  try {
    symlinkSync(
      dirname(artifactPath),
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const canonical = spawnSync(process.execPath, [artifactPath], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const linked = spawnSync(process.execPath, [resolve(linkedDirectory, basename(artifactPath))], {
      encoding: "utf8",
      timeout: 5_000,
    });

    assert.equal(linked.status, canonical.status);
    assert.equal(linked.stderr, canonical.stderr);

    if (process.platform !== "linux") {
      // The probe refuses before any platform work outside Linux x64; both
      // runs must therefore be byte-identical.
      assert.equal(linked.stdout, canonical.stdout);
      return;
    }

    // On Linux both bundles carry live per-process kernel values (Pid, Tgid,
    // memory counters, context switches) that legitimately differ between two
    // executions. The contract under test is that a directory link preserves
    // the probe's process contract: identical bundle structure, identical slot
    // states, identical field-key sets, and identical non-varying values.
    const normalize = (raw) => {
      const bundle = JSON.parse(raw);
      const liveFieldPattern =
        /^(Pid|Tgid|PPid|State|NStgid|NSpid|Threads|SigQ|VmPeak|VmSize|VmLck|VmPin|VmHWM|VmRSS|RssAnon|RssFile|RssShmem|VmData|VmStk|VmExe|VmLib|VmPTE|VmSwap|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):/u;
      const procSelfStatusText = bundle.procSelfStatus?.text ?? null;
      if (typeof procSelfStatusText !== "string") {
        return { bundle, fieldKeys: null, stableLines: procSelfStatusText };
      }
      const lines = procSelfStatusText.split("\n").filter((line) => line.length > 0);
      const fieldKeys = lines.map((line) => line.split(":")[0]).sort();
      const stableLines = lines.filter((line) => !liveFieldPattern.test(line)).join("\n");
      return { bundle, fieldKeys, stableLines };
    };

    const canonicalNormalized = normalize(canonical.stdout);
    const linkedNormalized = normalize(linked.stdout);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(linkedNormalized.bundle).map(([key, value]) => [key, value.state]),
      ),
      Object.fromEntries(
        Object.entries(canonicalNormalized.bundle).map(([key, value]) => [key, value.state]),
      ),
    );
    assert.deepEqual(linkedNormalized.fieldKeys, canonicalNormalized.fieldKeys);
    assert.equal(linkedNormalized.stableLines, canonicalNormalized.stableLines);
    assert.deepEqual(
      { ...linkedNormalized.bundle, procSelfStatus: undefined },
      { ...canonicalNormalized.bundle, procSelfStatus: undefined },
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the artifact emits only a raw bundle on Linux x64 and otherwise refuses", () => {
  const result = spawnSync(process.execPath, [artifactPath], {
    encoding: "utf8",
    timeout: 5_000,
  });

  if (process.platform !== "linux" || process.arch !== "x64") {
    assert.equal(result.status, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "RP_PROBE_UNSUPPORTED_RUNTIME\n");
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.endsWith("\n"), true);
  assert.equal(result.stdout.slice(0, -1).includes("\n"), false);
  const bundle = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(bundle), [
    "schema",
    "captureView",
    "platform",
    "procSelfStatus",
    "procSelfUidMap",
    "procSelfGidMap",
    "overflowUid",
    "overflowGid",
  ]);
  assert.equal(bundle.schema, "runparity.linux_rootless_privilege_probe_bundle/v1");
  assert.equal(bundle.captureView, "guest_probe_process_self");
  assert.deepEqual(bundle.platform, {
    state: "observed",
    text: "os=linux\narchitecture=amd64\n",
  });
  assert.doesNotMatch(
    result.stdout,
    /qualification|receipt|authorization|ledger|verdict|proof|session_bound/iu,
  );
});
