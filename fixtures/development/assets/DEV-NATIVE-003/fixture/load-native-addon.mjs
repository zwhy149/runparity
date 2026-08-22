import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = resolve(assetRoot, "fixture", "environment-a.json");
const libcDependencyByTarget = new Map([
  ["glibc", "libc.so.6"],
  ["musl", "libc.so"],
]);
const maximumSectionCount = 128;
const maximumNeededLibraries = 16;

function fail(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(64);
}

function isExactRecord(value, keys) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function containedAssetPath(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0 || isAbsolute(candidate)) return null;
  const absolute = resolve(assetRoot, candidate);
  const fromRoot = relative(assetRoot, absolute);
  if (
    fromRoot.length === 0 ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    return null;
  }
  return absolute;
}

function safeUInt64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) return null;
  const value = bytes.readBigUInt64LE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function containedRange(bytes, offset, length) {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.length &&
    length <= bytes.length - offset
  );
}

function section(bytes, sectionOffset, sectionEntrySize, index, sectionCount) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= sectionCount) return null;
  const offset = sectionOffset + index * sectionEntrySize;
  if (!containedRange(bytes, offset, sectionEntrySize)) return null;
  const fileOffset = safeUInt64(bytes, offset + 24);
  const byteLength = safeUInt64(bytes, offset + 32);
  const entrySize = safeUInt64(bytes, offset + 56);
  if (
    fileOffset === null ||
    byteLength === null ||
    entrySize === null ||
    !containedRange(bytes, fileOffset, byteLength)
  ) {
    return null;
  }
  return {
    type: bytes.readUInt32LE(offset + 4),
    linkedSection: bytes.readUInt32LE(offset + 40),
    fileOffset,
    byteLength,
    entrySize,
  };
}

function cString(bytes, offset, maximumOffset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= maximumOffset) return null;
  const terminator = bytes.indexOf(0, offset);
  if (terminator === -1 || terminator >= maximumOffset) return null;
  const value = bytes.toString("utf8", offset, terminator);
  return /^[A-Za-z0-9._+-]+$/u.test(value) ? value : null;
}

function parseElfNeededLibraries(bytes) {
  if (
    bytes.length < 64 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(16) !== 3 ||
    bytes.readUInt16LE(18) !== 0x3e
  ) {
    return null;
  }
  const sectionOffset = safeUInt64(bytes, 40);
  const sectionEntrySize = bytes.readUInt16LE(58);
  const sectionCount = bytes.readUInt16LE(60);
  if (
    sectionOffset === null ||
    sectionEntrySize < 64 ||
    sectionCount === 0 ||
    sectionCount > maximumSectionCount ||
    !containedRange(bytes, sectionOffset, sectionEntrySize * sectionCount)
  ) {
    return null;
  }
  const dynamicSections = Array.from({ length: sectionCount }, (_, index) =>
    section(bytes, sectionOffset, sectionEntrySize, index, sectionCount),
  ).filter((candidate) => candidate?.type === 6);
  if (dynamicSections.length !== 1) return null;
  const dynamic = dynamicSections[0];
  if (dynamic === undefined || dynamic.entrySize !== 16 || dynamic.byteLength % 16 !== 0) {
    return null;
  }
  const stringTable = section(
    bytes,
    sectionOffset,
    sectionEntrySize,
    dynamic.linkedSection,
    sectionCount,
  );
  if (stringTable === null || stringTable.type !== 3 || stringTable.byteLength === 0) return null;

  const needed = [];
  for (
    let offset = dynamic.fileOffset;
    offset < dynamic.fileOffset + dynamic.byteLength;
    offset += 16
  ) {
    if (bytes.readBigUInt64LE(offset) !== 1n) continue;
    const stringOffset = safeUInt64(bytes, offset + 8);
    if (stringOffset === null || stringOffset >= stringTable.byteLength) return null;
    const library = cString(
      bytes,
      stringTable.fileOffset + stringOffset,
      stringTable.fileOffset + stringTable.byteLength,
    );
    if (library === null || needed.includes(library) || needed.length >= maximumNeededLibraries) {
      return null;
    }
    needed.push(library);
  }
  return needed;
}

function parseLayer(value) {
  if (
    !isExactRecord(value, [
      "c_standard",
      "napi_version",
      "needed_shared_object",
      "path",
      "sha256",
      "target_libc",
    ]) ||
    typeof value.path !== "string" ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    value.napi_version !== 1 ||
    typeof value.target_libc !== "string" ||
    !libcDependencyByTarget.has(value.target_libc) ||
    value.needed_shared_object !== libcDependencyByTarget.get(value.target_libc) ||
    value.c_standard !== "c11"
  ) {
    return null;
  }
  const path = containedAssetPath(value.path);
  return path === null ? null : { ...value, path };
}

let environment;
try {
  environment = JSON.parse(readFileSync(environmentPath, "utf8"));
} catch {
  fail("RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER");
}

if (
  !isExactRecord(environment, [
    "matching",
    "matching_napi_version",
    "matching_node_version",
    "platform",
    "schema",
    "selected",
  ]) ||
  environment.schema !== "runparity.fixture-native-libc-layer/v1" ||
  !isExactRecord(environment.platform, ["arch", "libc", "os"]) ||
  environment.platform.os !== "linux" ||
  environment.platform.arch !== "x64" ||
  environment.platform.libc !== "glibc" ||
  environment.matching_napi_version !== 1 ||
  typeof environment.matching_node_version !== "string" ||
  !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(environment.matching_node_version)
) {
  fail("RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER");
}

const selected = parseLayer(environment.selected);
const matching = parseLayer(environment.matching);
if (
  selected === null ||
  matching === null ||
  selected.napi_version !== environment.matching_napi_version ||
  matching.napi_version !== environment.matching_napi_version
) {
  fail("RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER");
}

let nativeBytes;
try {
  nativeBytes = readFileSync(selected.path);
} catch {
  fail("RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER");
}
if (createHash("sha256").update(nativeBytes).digest("hex") !== selected.sha256) {
  fail("RP_FIXTURE_NATIVE_LAYER_INTEGRITY");
}

const neededLibraries = parseElfNeededLibraries(nativeBytes);
if (neededLibraries === null || !neededLibraries.includes(selected.needed_shared_object)) {
  fail("RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER");
}
if (selected.target_libc !== environment.platform.libc) {
  fail("RP_FIXTURE_NATIVE_LIBC_MISMATCH");
}
if (
  process.platform !== environment.platform.os ||
  process.arch !== environment.platform.arch ||
  process.versions.node !== environment.matching_node_version ||
  Number(process.versions.napi) < environment.matching_napi_version
) {
  fail("RP_FIXTURE_NATIVE_RUNTIME_UNSUPPORTED");
}

const addon = createRequire(import.meta.url)(selected.path);
if (typeof addon.fixtureMarker !== "function" || addon.fixtureMarker() !== "dev-native-003") {
  fail("RP_FIXTURE_INVALID_NATIVE_ADDON");
}
process.stdout.write("RUNPARITY_OK:dev-native-003\n");
