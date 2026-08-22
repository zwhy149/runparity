import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { isProxy } from "node:util/types";

const HARD_LIMITS = Object.freeze({
  maxFiles: 256,
  maxBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxDirectories: 256,
  maxDepth: 32,
});
const SAFE_COMPONENT = /^[A-Za-z0-9._-]+$/u;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function fail(message) {
  throw new Error(`RP_ASSET_INVENTORY_INVALID: ${message}`);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validLimit(value, label, hardCap) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  if (value > hardCap) fail(`${label} cannot exceed hard cap ${hardCap}`);
  return value;
}

function limitsFrom(options) {
  if (options === undefined) return HARD_LIMITS;
  if (
    typeof options !== "object" ||
    options === null ||
    isProxy(options) ||
    Array.isArray(options)
  ) {
    fail("options must be an inert object");
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("options must be a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const allowed = Object.keys(HARD_LIMITS);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.includes(key)) fail(`unknown option: ${String(key)}`);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      fail(`option must be an enumerable data property: ${key}`);
    }
  }
  const valueFor = (key) =>
    Object.hasOwn(descriptors, key)
      ? (descriptors[key].value ?? HARD_LIMITS[key])
      : HARD_LIMITS[key];
  return Object.freeze({
    maxFiles: validLimit(valueFor("maxFiles"), "maxFiles", HARD_LIMITS.maxFiles),
    maxBytes: validLimit(valueFor("maxBytes"), "maxBytes", HARD_LIMITS.maxBytes),
    maxTotalBytes: validLimit(
      valueFor("maxTotalBytes"),
      "maxTotalBytes",
      HARD_LIMITS.maxTotalBytes,
    ),
    maxDirectories: validLimit(
      valueFor("maxDirectories"),
      "maxDirectories",
      HARD_LIMITS.maxDirectories,
    ),
    maxDepth: validLimit(valueFor("maxDepth"), "maxDepth", HARD_LIMITS.maxDepth),
  });
}

function statIdentity(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function lstatRegular(path, relativePath) {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch {
    fail(`cannot lstat ${relativePath}`);
  }
  if (stat.isSymbolicLink()) fail(`symbolic link is not allowed: ${relativePath}`);
  if (stat.isDirectory() || stat.isFile()) return stat;
  fail(`non-regular asset node is not allowed: ${relativePath}`);
}

function validateComponent(component, displayPath) {
  if (!SAFE_COMPONENT.test(component) || component === "." || component === "..") {
    fail(`unsafe relative path: ${displayPath}`);
  }
  if (component.endsWith(".")) fail(`trailing dot is not allowed: ${displayPath}`);
  if (WINDOWS_RESERVED_COMPONENT.test(component)) {
    fail(`reserved path component is not allowed: ${displayPath}`);
  }
}

function relativeInventoryPath(root, absolutePath) {
  const path = relative(root, absolutePath).split(sep).join("/");
  if (path.length === 0 || path === "." || path.startsWith("../")) {
    fail(`unsafe relative path: ${path || absolutePath}`);
  }
  for (const component of path.split("/")) validateComponent(component, path);
  return path;
}

function isContained(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`);
}

function freezeInventory(files, totalBytes) {
  const frozenFiles = Object.freeze(
    files.map((file) =>
      Object.freeze({ path: file.path, size_bytes: file.size_bytes, sha256: file.sha256 }),
    ),
  );
  return Object.freeze({
    schema_version: "runparity.asset-inventory/v1",
    files: frozenFiles,
    total_bytes: totalBytes,
  });
}

function readBoundedFile(absolutePath, relativePath, before, limits, rootDevice) {
  if (before.nlink > 1n) fail(`hard-linked file is not allowed: ${relativePath}`);
  if (before.dev !== rootDevice) fail(`cross-device asset is not allowed: ${relativePath}`);
  if (before.size > BigInt(limits.maxBytes)) fail(`file exceeds maxBytes: ${relativePath}`);

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | noFollow);
  } catch {
    fail(`cannot open asset file without following links: ${relativePath}`);
  }
  let bytes;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameIdentity(statIdentity(before), statIdentity(opened))) {
      fail(`asset file changed before reading: ${relativePath}`);
    }
    const expectedBytes = Number(opened.size);
    const boundedBuffer = Buffer.allocUnsafe(expectedBytes + 1);
    let offset = 0;
    while (offset < boundedBuffer.length) {
      const read = readSync(descriptor, boundedBuffer, offset, boundedBuffer.length - offset, null);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== expectedBytes) fail(`asset file changed while reading: ${relativePath}`);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(statIdentity(opened), statIdentity(afterDescriptor))) {
      fail(`asset file changed while reading: ${relativePath}`);
    }
    bytes = Buffer.from(boundedBuffer.subarray(0, expectedBytes));
  } finally {
    closeSync(descriptor);
  }
  const afterPath = lstatRegular(absolutePath, relativePath);
  if (!afterPath.isFile() || !sameIdentity(statIdentity(before), statIdentity(afterPath))) {
    fail(`asset file changed after reading: ${relativePath}`);
  }
  return bytes;
}

export function inspectAssetTree(assetRoot, options) {
  const limits = limitsFrom(options);
  if (typeof assetRoot !== "string" || assetRoot.length === 0) {
    fail("assetRoot must be a non-empty string");
  }

  let rootStat;
  try {
    rootStat = lstatSync(assetRoot, { bigint: true });
  } catch {
    fail("assetRoot does not exist");
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail("assetRoot must be a real non-symlink directory");
  }
  let root;
  try {
    root = realpathSync.native(assetRoot);
  } catch {
    fail("assetRoot cannot be resolved");
  }
  const resolvedRootStat = lstatRegular(root, "assetRoot");
  if (
    !resolvedRootStat.isDirectory() ||
    !sameIdentity(statIdentity(rootStat), statIdentity(resolvedRootStat))
  ) {
    fail("assetRoot changed while resolving");
  }

  const files = [];
  const foldedPaths = new Set();
  let totalBytes = 0n;
  let directoryCount = 0;
  let nodeCount = 0;
  const maxNodes = limits.maxFiles + limits.maxDirectories;

  const visit = (directory, depth) => {
    if (depth > limits.maxDepth) fail("directory depth exceeds maxDepth");
    const displayDirectory = depth === 0 ? "assetRoot" : relativeInventoryPath(root, directory);
    const directoryBefore = lstatRegular(directory, displayDirectory);
    if (!directoryBefore.isDirectory()) fail(`asset directory became a file: ${displayDirectory}`);
    if (directoryBefore.dev !== resolvedRootStat.dev) {
      fail(`cross-device asset directory is not allowed: ${displayDirectory}`);
    }
    let canonicalDirectory;
    try {
      canonicalDirectory = realpathSync.native(directory);
    } catch {
      fail(`cannot resolve asset directory: ${displayDirectory}`);
    }
    if (!isContained(root, canonicalDirectory)) {
      fail(`asset directory escapes assetRoot: ${displayDirectory}`);
    }

    let handle;
    const entries = [];
    try {
      handle = opendirSync(directory);
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        nodeCount += 1;
        if (nodeCount > maxNodes) fail("asset node count exceeds hard policy");
        entries.push(entry);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("RP_ASSET_INVENTORY_INVALID:")) {
        throw error;
      }
      fail(`cannot read asset directory: ${displayDirectory}`);
    } finally {
      handle?.closeSync();
    }
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const path = relativeInventoryPath(root, absolutePath);
      const foldedPath = path.toLowerCase();
      if (foldedPaths.has(foldedPath)) fail(`case-folded path conflict: ${path}`);
      foldedPaths.add(foldedPath);

      const stat = lstatRegular(absolutePath, path);
      if (stat.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > limits.maxDirectories) {
          fail("directory count exceeds maxDirectories");
        }
        visit(absolutePath, depth + 1);
        continue;
      }
      if (files.length >= limits.maxFiles) fail("file count exceeds maxFiles");
      if (totalBytes + stat.size > BigInt(limits.maxTotalBytes)) {
        fail("asset tree exceeds maxTotalBytes");
      }
      const bytes = readBoundedFile(absolutePath, path, stat, limits, resolvedRootStat.dev);
      files.push({
        path,
        size_bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      totalBytes += BigInt(bytes.length);
    }

    const directoryAfter = lstatRegular(directory, displayDirectory);
    if (
      !directoryAfter.isDirectory() ||
      !sameIdentity(statIdentity(directoryBefore), statIdentity(directoryAfter))
    ) {
      fail(`asset directory changed while reading: ${displayDirectory}`);
    }
    let canonicalDirectoryAfter;
    try {
      canonicalDirectoryAfter = realpathSync.native(directory);
    } catch {
      fail(`cannot resolve asset directory after reading: ${displayDirectory}`);
    }
    if (canonicalDirectoryAfter !== canonicalDirectory) {
      fail(`asset directory target changed while reading: ${displayDirectory}`);
    }
  };

  visit(root, 0);
  if (files.length === 0) fail("asset tree must contain at least one regular file");
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  const inventory = freezeInventory(files, Number(totalBytes));
  const canonicalJson = JSON.stringify(inventory);
  return Object.freeze({
    source_stability: "unqualified_live_tree",
    inventory,
    canonical_json: canonicalJson,
    sha256: createHash("sha256").update(canonicalJson).digest("hex"),
  });
}
