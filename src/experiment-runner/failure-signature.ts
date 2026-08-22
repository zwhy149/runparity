import { canonicalJsonString, sha256Hex } from "../backend/digest.js";

/**
 * Versioned cross-arm failure signatures.
 *
 * A signature is a canonical, structured projection of one arm's observable
 * outcome that deliberately excludes unstable values: timestamps, durations,
 * PIDs, container names, byte counts, and raw stream text. Only typed
 * sentinel lines and exit codes are compared, so A1/A2 equality is a claim
 * about the reproduced failure mode, never about incidental run details.
 */

export type ArmStreamObservation = Readonly<{
  exit_code: number | null;
  stdout_lines: readonly string[];
  stderr_lines: readonly string[];
}>;

export type PathShadowingSignature = Readonly<{
  schema_version: "runparity.failure-signature/path-shadowing/v1";
  family: "PATH_SHADOWING";
  exit_code: number | null;
  stdout_sentinels: readonly string[];
  stderr_sentinels: readonly string[];
}>;

const STDOUT_SENTINEL_PREFIX = "RUNPARITY_OK:";
const STDERR_SENTINEL_PREFIX = "RP_FIXTURE_";
const MAX_SIGNATURE_LINES = 16;

/**
 * Stable real-runtime error classifiers. These classify OBSERVED loader and
 * runtime failures into typed sentinels so cross-arm equality is a claim
 * about the reproduced failure class, never about stack noise, PIDs, or
 * timestamps. Line text is bounded and deterministic for a fixed image.
 */
const STDERR_ERROR_CLASSIFIERS: readonly {
  test: (line: string) => boolean;
  render: (line: string) => string;
}[] = [
  {
    test: (line) => line.includes("ERR_MODULE_NOT_FOUND"),
    render: (line) => `NODE_ERR_MODULE_NOT_FOUND:${line.slice(0, 96)}`,
  },
  {
    test: (line) => line.startsWith("Error: Cannot find module '"),
    render: (line) => `NODE_CANNOT_FIND_MODULE:${line.slice(0, 96)}`,
  },
  {
    test: (line) => line.includes("NODE_MODULE_VERSION"),
    render: (line) => `NODE_MODULE_VERSION_MISMATCH:${line.slice(0, 96)}`,
  },
  {
    test: (line) => line.includes("ERR_DLOPEN_FAILED"),
    render: (line) => `NODE_ERR_DLOPEN_FAILED:${line.slice(0, 96)}`,
  },
];

function classifyStderrLine(line: string): string | null {
  const trimmed = line.trim();
  for (const classifier of STDERR_ERROR_CLASSIFIERS) {
    if (classifier.test(trimmed)) {
      return classifier.render(trimmed);
    }
  }
  return null;
}

function classifySentinels(lines: readonly string[], prefix: string): readonly string[] {
  const sentinels: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      const token = trimmed.slice(0, 128);
      if (!sentinels.includes(token)) {
        sentinels.push(token);
      }
    }
    if (sentinels.length >= MAX_SIGNATURE_LINES) {
      break;
    }
  }
  return Object.freeze(sentinels);
}

function classifyErrorClasses(lines: readonly string[]): readonly string[] {
  const sentinels: string[] = [];
  for (const line of lines) {
    const sentinel = classifyStderrLine(line);
    if (sentinel !== null && !sentinels.includes(sentinel)) {
      sentinels.push(sentinel);
    }
    if (sentinels.length >= MAX_SIGNATURE_LINES) {
      break;
    }
  }
  return Object.freeze(sentinels.sort());
}

export function buildPathShadowingSignature(
  observation: ArmStreamObservation,
): PathShadowingSignature {
  return Object.freeze({
    schema_version: "runparity.failure-signature/path-shadowing/v1",
    family: "PATH_SHADOWING",
    exit_code: observation.exit_code,
    stdout_sentinels: classifySentinels(observation.stdout_lines, STDOUT_SENTINEL_PREFIX),
    stderr_sentinels: Object.freeze([
      ...classifySentinels(observation.stderr_lines, STDERR_SENTINEL_PREFIX),
      ...classifyErrorClasses(observation.stderr_lines),
    ]),
  });
}

export function signatureCanonicalJson(signature: PathShadowingSignature): string {
  return canonicalJsonString(signature);
}

export function signatureSha256(signature: PathShadowingSignature): string {
  return sha256Hex(signatureCanonicalJson(signature));
}

export function signaturesEqual(
  left: PathShadowingSignature,
  right: PathShadowingSignature,
): boolean {
  return signatureCanonicalJson(left) === signatureCanonicalJson(right);
}
