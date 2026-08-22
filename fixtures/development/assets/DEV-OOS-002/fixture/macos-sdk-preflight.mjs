// DEV-OOS-002 fixture: read-only macOS SDK preflight.
//
// The fixture records SDK presence or absence without changing host state and
// without launching child processes or using the network, then reports that an
// isolated SDK-dependent proof is unsupported: V1 has no qualified native macOS
// isolation backend. RunParity's own refusal for the proof request remains a
// separate, unimplemented CLI flow; this fixture only supplies the honest
// target-side evidence described by the case manifest.
//
// This module performs read-only filesystem observation only. It never writes,
// spawns, or consults the environment; the outcome depends only on the host
// platform and the SDK directories that already exist on it.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const MACOS_SDK_DIRECTORY_CANDIDATES = [
  "/Library/Developer/CommandLineTools/SDKs",
  "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs",
];

function firstObservedSdkPath() {
  for (const candidate of MACOS_SDK_DIRECTORY_CANDIDATES) {
    let entries = null;
    try {
      entries = readdirSync(candidate);
    } catch {
      continue;
    }
    const sdkNames = entries.filter((name) => name.endsWith(".sdk")).sort();
    if (sdkNames.length > 0) return resolve(candidate, sdkNames[0]);
  }
  return null;
}

if (process.platform === "darwin") {
  const sdkPath = firstObservedSdkPath();
  process.stdout.write(sdkPath === null ? "SDK_ABSENT\n" : `SDK_OBSERVED:${sdkPath}\n`);
}
process.stderr.write("RP_FIXTURE_MACOS_SDK_PROOF_UNSUPPORTED\n");
process.exitCode = 23;
