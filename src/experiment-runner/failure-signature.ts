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

export function buildPathShadowingSignature(
  observation: ArmStreamObservation,
): PathShadowingSignature {
  return Object.freeze({
    schema_version: "runparity.failure-signature/path-shadowing/v1",
    family: "PATH_SHADOWING",
    exit_code: observation.exit_code,
    stdout_sentinels: classifySentinels(observation.stdout_lines, STDOUT_SENTINEL_PREFIX),
    stderr_sentinels: classifySentinels(observation.stderr_lines, STDERR_SENTINEL_PREFIX),
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
