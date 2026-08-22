import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const STABLE_INTERVAL = /^>=(\S+) <(\S+)$/u;

function parseStableVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.match(STABLE_VERSION);
  if (match === null) return null;
  const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateNodeVersion(activeVersion, selector) {
  if (typeof selector !== "string") return Object.freeze({ status: "invalid_selector" });
  const interval = selector.match(STABLE_INTERVAL);
  if (interval === null) return Object.freeze({ status: "invalid_selector" });
  const lower = parseStableVersion(interval[1]);
  const upper = parseStableVersion(interval[2]);
  if (lower === null || upper === null || compareVersions(lower, upper) >= 0) {
    return Object.freeze({ status: "invalid_selector" });
  }
  const active = parseStableVersion(activeVersion);
  if (active === null) return Object.freeze({ status: "invalid_version" });
  const satisfies = compareVersions(active, lower) >= 0 && compareVersions(active, upper) < 0;
  return Object.freeze({ status: satisfies ? "satisfied" : "outside_range" });
}

function readDeclaredSelector() {
  const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const selector = manifest?.engines?.node;
  if (typeof selector !== "string") throw new Error("missing engines.node");
  return selector;
}

function runFixture() {
  if (
    process.execArgv.length !== 0 ||
    (typeof process.env.NODE_OPTIONS === "string" && process.env.NODE_OPTIONS.length !== 0)
  ) {
    process.stderr.write("RP_FIXTURE_UNCONTROLLED_NODE_PRELOAD\n");
    return 64;
  }

  let selector;
  try {
    selector = readDeclaredSelector();
  } catch {
    process.stderr.write("RP_FIXTURE_INVALID_ENGINES_CONTRACT\n");
    return 24;
  }

  const evaluation = evaluateNodeVersion(process.versions.node, selector);
  if (evaluation.status === "satisfied") {
    process.stdout.write("RUNPARITY_OK:dev-runtime-001\n");
    return 0;
  }
  if (evaluation.status === "outside_range") {
    process.stderr.write(
      `RP_FIXTURE_NODE_OUTSIDE_ENGINES active=${process.versions.node} expected=${selector}\n`,
    );
    return 23;
  }
  process.stderr.write("RP_FIXTURE_INVALID_ENGINES_CONTRACT\n");
  return 24;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  process.exitCode = runFixture();
}
