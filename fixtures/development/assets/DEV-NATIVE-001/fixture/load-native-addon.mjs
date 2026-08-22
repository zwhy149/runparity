import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = resolve(assetRoot, "fixture", "environment-a.json");

function fail(reason) {
  process.stderr.write(`${reason}\n`);
  process.exitCode = 64;
}

function containedAssetPath(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0 || isAbsolute(candidate)) return null;
  const absolute = resolve(assetRoot, candidate);
  const fromRoot = relative(assetRoot, absolute);
  if (fromRoot.length === 0 || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return null;
  return absolute;
}

let environment;
try {
  environment = JSON.parse(readFileSync(environmentPath, "utf8"));
} catch {
  fail("RP_FIXTURE_INVALID_NATIVE_LAYER");
}

if (environment !== undefined) {
  const selected = environment?.selected;
  const selectedPath = containedAssetPath(selected?.path);
  if (
    environment?.schema !== "runparity.fixture-native-layer/v1" ||
    selectedPath === null ||
    typeof selected?.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(selected.sha256)
  ) {
    fail("RP_FIXTURE_INVALID_NATIVE_LAYER");
  } else {
    let nativeBytes;
    try {
      nativeBytes = readFileSync(selectedPath);
    } catch {
      fail("RP_FIXTURE_INVALID_NATIVE_LAYER");
    }
    if (nativeBytes !== undefined) {
      const digest = createHash("sha256").update(nativeBytes).digest("hex");
      if (digest !== selected.sha256) {
        fail("RP_FIXTURE_NATIVE_LAYER_INTEGRITY");
      } else {
        const addon = createRequire(import.meta.url)(selectedPath);
        if (
          typeof addon.fixtureMarker !== "function" ||
          addon.fixtureMarker() !== "dev-native-001"
        ) {
          fail("RP_FIXTURE_INVALID_NATIVE_ADDON");
        } else {
          process.stdout.write("RUNPARITY_OK:dev-native-001\n");
        }
      }
    }
  }
}
