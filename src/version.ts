import { readFileSync } from "node:fs";
import { valid } from "semver";

type PackageMetadata = {
  version?: unknown;
};

function readCliVersion(): string {
  const rawMetadata: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  if (typeof rawMetadata !== "object" || rawMetadata === null || !("version" in rawMetadata)) {
    throw new Error("RunParity package metadata is missing a version");
  }

  const version = (rawMetadata as PackageMetadata).version;
  if (typeof version !== "string" || valid(version) === null) {
    throw new Error("RunParity package metadata contains an invalid semantic version");
  }

  return version;
}

export const CLI_VERSION = readCliVersion();
