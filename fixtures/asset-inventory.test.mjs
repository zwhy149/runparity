import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectAssetTree } from "./lib/asset-inventory.mjs";

function temporaryAssetRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "runparity-asset-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function expectInvalid(callback, pattern) {
  assert.throws(callback, new RegExp(`RP_ASSET_INVENTORY_INVALID: .*${pattern}`, "i"));
}

test("creates a frozen, canonically ordered inventory for regular assets", (t) => {
  const root = temporaryAssetRoot(t);
  writeFileSync(join(root, "z.txt"), "z", "utf8");
  writeFileSync(join(root, "a.txt"), "abc", "utf8");

  const result = inspectAssetTree(root);

  assert.deepEqual(result.inventory, {
    schema_version: "runparity.asset-inventory/v1",
    files: [
      {
        path: "a.txt",
        size_bytes: 3,
        sha256: createHash("sha256").update("abc").digest("hex"),
      },
      {
        path: "z.txt",
        size_bytes: 1,
        sha256: createHash("sha256").update("z").digest("hex"),
      },
    ],
    total_bytes: 4,
  });
  assert.equal(result.canonical_json, JSON.stringify(result.inventory));
  assert.equal(result.sha256, createHash("sha256").update(result.canonical_json).digest("hex"));
  assert.equal(result.source_stability, "unqualified_live_tree");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.inventory), true);
  assert.equal(Object.isFrozen(result.inventory.files), true);
  assert.equal(Object.isFrozen(result.inventory.files[0]), true);
});

test("requires a real, non-empty directory root", (t) => {
  const root = temporaryAssetRoot(t);
  const file = join(root, "not-a-directory.txt");
  writeFileSync(file, "x", "utf8");

  expectInvalid(() => inspectAssetTree(join(root, "missing")), "does not exist");
  expectInvalid(() => inspectAssetTree(file), "real non-symlink directory");

  const empty = join(root, "empty");
  mkdirSync(empty);
  expectInvalid(() => inspectAssetTree(empty), "at least one regular file");
});

test("recurses through ASCII-safe directories and rejects unsafe relative paths", (t) => {
  const root = temporaryAssetRoot(t);
  const nested = join(root, ".assets", "nested-dir");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "entry.mjs"), "export {};", "utf8");

  assert.deepEqual(
    inspectAssetTree(root).inventory.files.map((file) => file.path),
    [".assets/nested-dir/entry.mjs"],
  );

  writeFileSync(join(root, "unsafe name.txt"), "x", "utf8");
  expectInvalid(() => inspectAssetTree(root), "unsafe relative path");
});

test("rejects file-count, per-file, and aggregate byte limits", (t) => {
  const root = temporaryAssetRoot(t);
  writeFileSync(join(root, "a.txt"), "ab", "utf8");
  writeFileSync(join(root, "b.txt"), "cd", "utf8");

  expectInvalid(() => inspectAssetTree(root, { maxFiles: 1 }), "file count exceeds maxFiles");
  expectInvalid(() => inspectAssetTree(root, { maxBytes: 1 }), "file exceeds maxBytes");
  expectInvalid(() => inspectAssetTree(root, { maxTotalBytes: 3 }), "exceeds maxTotalBytes");
  expectInvalid(() => inspectAssetTree(root, { maxFiles: -1 }), "maxFiles must be");
  expectInvalid(() => inspectAssetTree(root, { maxFiles: 257 }), "cannot exceed hard cap");
  expectInvalid(
    () => inspectAssetTree(root, { maxBytes: 1024 * 1024 + 1 }),
    "cannot exceed hard cap",
  );
  expectInvalid(() => inspectAssetTree(root, { unknownLimit: 1 }), "unknown option");
});

test("rejects accessor limits and ignores descriptor prototype pollution", (t) => {
  const root = temporaryAssetRoot(t);
  writeFileSync(join(root, "a.txt"), "a", "utf8");
  writeFileSync(join(root, "b.txt"), "b", "utf8");

  let getterCalls = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "maxFiles", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  Object.defineProperty(Object.prototype, "value", { configurable: true, value: 1 });
  let accessorError;
  try {
    inspectAssetTree(root, accessorOptions);
  } catch (error) {
    accessorError = error;
  } finally {
    Reflect.deleteProperty(Object.prototype, "value");
  }
  assert.match(
    String(accessorError),
    /RP_ASSET_INVENTORY_INVALID: .*option must be an enumerable data property/i,
  );
  assert.equal(getterCalls, 0);

  Object.defineProperty(Object.prototype, "maxFiles", {
    configurable: true,
    value: { enumerable: true, value: 1 },
  });
  let result;
  let resultError;
  try {
    result = inspectAssetTree(root, {});
  } catch (error) {
    resultError = error;
  } finally {
    Reflect.deleteProperty(Object.prototype, "maxFiles");
  }
  assert.ifError(resultError);
  assert.equal(result.inventory.files.length, 2);
});

test("preserves default limits for explicit nullish option values", (t) => {
  const root = temporaryAssetRoot(t);
  writeFileSync(join(root, "a.txt"), "a", "utf8");
  writeFileSync(join(root, "b.txt"), "b", "utf8");

  const result = inspectAssetTree(root, { maxFiles: undefined, maxBytes: null });

  assert.equal(result.inventory.files.length, 2);
});

test("bounds directory count and recursion depth independently from file count", (t) => {
  const wideRoot = temporaryAssetRoot(t);
  writeFileSync(join(wideRoot, "entry.txt"), "asset", "utf8");
  for (let index = 0; index < 257; index += 1) {
    mkdirSync(join(wideRoot, `d${String(index).padStart(3, "0")}`));
  }
  expectInvalid(() => inspectAssetTree(wideRoot), "directory count exceeds maxDirectories");

  const deepRoot = temporaryAssetRoot(t);
  let directory = deepRoot;
  for (let depth = 0; depth < 33; depth += 1) {
    directory = join(directory, "d");
    mkdirSync(directory);
  }
  writeFileSync(join(directory, "entry.txt"), "asset", "utf8");
  expectInvalid(() => inspectAssetTree(deepRoot), "depth exceeds maxDepth");
});

test("rejects Win32 reserved aliases and trailing-dot components", (t) => {
  if (process.platform === "win32") {
    t.skip("Win32 does not permit creating these cross-platform aliases");
    return;
  }
  const reservedRoot = temporaryAssetRoot(t);
  writeFileSync(join(reservedRoot, "CON"), "asset", "utf8");
  expectInvalid(() => inspectAssetTree(reservedRoot), "reserved path component");

  const trailingDotRoot = temporaryAssetRoot(t);
  writeFileSync(join(trailingDotRoot, "entry."), "asset", "utf8");
  expectInvalid(() => inspectAssetTree(trailingDotRoot), "trailing dot");
});

test("rejects a hard-linked file", (t) => {
  const root = temporaryAssetRoot(t);
  const original = join(root, "original.txt");
  writeFileSync(original, "asset", "utf8");
  linkSync(original, join(root, "linked.txt"));

  expectInvalid(() => inspectAssetTree(root), "hard-linked file");
});

test("rejects actual symbolic links when the platform permits creating them", (t) => {
  const root = temporaryAssetRoot(t);
  const target = join(root, "target.txt");
  writeFileSync(target, "asset", "utf8");
  try {
    symlinkSync(target, join(root, "linked.txt"), "file");
  } catch (error) {
    if (process.platform === "win32") {
      t.skip(`symbolic links require a Windows privilege or Developer Mode: ${String(error)}`);
      return;
    }
    throw error;
  }

  expectInvalid(() => inspectAssetTree(root), "symbolic link");
});

test("rejects Windows junction reparse points", (t) => {
  if (process.platform !== "win32") {
    t.skip("junction-specific coverage runs on Windows");
    return;
  }
  const root = temporaryAssetRoot(t);
  const target = join(root, "target");
  mkdirSync(target);
  writeFileSync(join(target, "asset.txt"), "asset", "utf8");
  symlinkSync(target, join(root, "junction"), "junction");

  expectInvalid(() => inspectAssetTree(root), "symbolic link");
});

test("rejects case-folded relative-path conflicts on case-sensitive filesystems", (t) => {
  const root = temporaryAssetRoot(t);
  writeFileSync(join(root, "Alpha.txt"), "A", "utf8");
  writeFileSync(join(root, "Bravo.txt"), "B", "utf8");
  writeFileSync(join(root, "alpha.txt"), "a", "utf8");
  const names = new Set(readdirSync(root));
  if (!names.has("Alpha.txt") || !names.has("alpha.txt")) {
    t.skip("the test filesystem is case-insensitive");
    return;
  }

  expectInvalid(() => inspectAssetTree(root), "case-folded path conflict");
});

test("rejects FIFO nodes on platforms that support mkfifo", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not provide mkfifo");
    return;
  }
  const root = temporaryAssetRoot(t);
  const fifo = join(root, "pipe");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  if (created.status !== 0) {
    t.skip(`mkfifo unavailable: ${created.stderr}`);
    return;
  }

  expectInvalid(() => inspectAssetTree(root), "non-regular asset node");
});
