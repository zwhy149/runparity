import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = resolve(assetRoot, "fixture", "environment-a.json");
const supportedArchitectures = new Map([
  [0x3e, "x64"],
  [0xb7, "arm64"],
]);

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

function parseElfArchitecture(bytes) {
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1
  ) {
    return null;
  }
  return supportedArchitectures.get(bytes.readUInt16LE(18)) ?? null;
}

function parseLayer(value) {
  if (
    !isExactRecord(value, [
      "cxx_standard",
      "node_module_version",
      "path",
      "sha256",
      "target_arch",
    ]) ||
    typeof value.path !== "string" ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    typeof value.node_module_version !== "string" ||
    !/^[0-9]+$/u.test(value.node_module_version) ||
    typeof value.target_arch !== "string" ||
    !["x64", "arm64"].includes(value.target_arch) ||
    value.cxx_standard !== "c++20"
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
  fail("RP_FIXTURE_INVALID_NATIVE_ARCH_LAYER");
}

if (
  !isExactRecord(environment, [
    "matching",
    "matching_node_module_version",
    "platform",
    "schema",
    "selected",
  ]) ||
  environment.schema !== "runparity.fixture-native-architecture-layer/v1" ||
  !isExactRecord(environment.platform, ["arch", "libc", "os"]) ||
  environment.platform.os !== "linux" ||
  environment.platform.arch !== "x64" ||
  environment.platform.libc !== "glibc" ||
  typeof environment.matching_node_module_version !== "string" ||
  !/^[0-9]+$/u.test(environment.matching_node_module_version)
) {
  fail("RP_FIXTURE_INVALID_NATIVE_ARCH_LAYER");
}

const selected = parseLayer(environment.selected);
const matching = parseLayer(environment.matching);
if (
  selected === null ||
  matching === null ||
  selected.node_module_version !== environment.matching_node_module_version ||
  matching.node_module_version !== environment.matching_node_module_version
) {
  fail("RP_FIXTURE_INVALID_NATIVE_ARCH_LAYER");
}

let nativeBytes;
try {
  nativeBytes = readFileSync(selected.path);
} catch {
  fail("RP_FIXTURE_INVALID_NATIVE_ARCH_LAYER");
}
if (createHash("sha256").update(nativeBytes).digest("hex") !== selected.sha256) {
  fail("RP_FIXTURE_NATIVE_LAYER_INTEGRITY");
}

const actualArchitecture = parseElfArchitecture(nativeBytes);
if (actualArchitecture === null || actualArchitecture !== selected.target_arch) {
  fail("RP_FIXTURE_INVALID_NATIVE_ARCH_LAYER");
}
if (actualArchitecture !== environment.platform.arch) {
  fail("RP_FIXTURE_NATIVE_ARCH_MISMATCH");
}
if (
  process.platform !== environment.platform.os ||
  process.arch !== environment.platform.arch ||
  process.versions.modules !== environment.matching_node_module_version
) {
  fail("RP_FIXTURE_NATIVE_RUNTIME_UNSUPPORTED");
}

const addon = createRequire(import.meta.url)(selected.path);
if (typeof addon.fixtureMarker !== "function" || addon.fixtureMarker() !== "dev-native-002") {
  fail("RP_FIXTURE_INVALID_NATIVE_ADDON");
}
process.stdout.write("RUNPARITY_OK:dev-native-002\n");
