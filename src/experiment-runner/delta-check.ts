import type { InterventionDescriptor } from "./case-plans.js";

/**
 * Single-token intervention delta check (shared by the ledger builder and the
 * in-repository proof verifier). The independent fixture validator
 * (fixtures/lib/evidence-verifier.mjs) re-implements this logic deliberately.
 *
 * Invariant: the B arm's full normalized argv differs from A1's at exactly
 * ONE position, and that position's tokens satisfy the declared intervention
 * kind. A1 and A2 normalized argv must be identical.
 */

export type DeltaEvaluation = Readonly<{
  single_token_delta: boolean;
  delta_index: number | null;
  delta_valid: boolean;
  reason: string;
}>;

function mountTokenParts(token: string): { source: string; containerPath: string } | null {
  const parts = token.split(":");
  if (parts.length !== 3) {
    return null;
  }
  return { source: parts[0] ?? "", containerPath: parts[1] ?? "" };
}

function validateKindSemantics(
  aToken: string,
  bToken: string,
  descriptor: InterventionDescriptor,
): boolean {
  const kind = descriptor.kind;
  if (kind === "path.prepend") {
    const prefix = `PATH=${descriptor.directory ?? descriptor.value ?? ""}:`;
    return aToken.startsWith("PATH=") && bToken === `${prefix}${aToken.slice("PATH=".length)}`;
  }
  if (kind === "env.value") {
    const name = descriptor.envName ?? "";
    return (
      name !== "" &&
      aToken.startsWith(`${name}=`) &&
      bToken === `${name}=${descriptor.value ?? ""}` &&
      aToken !== bToken
    );
  }
  if (kind === "mount.source") {
    const aParts = mountTokenParts(aToken);
    const bParts = mountTokenParts(bToken);
    if (aParts === null || bParts === null) {
      return false;
    }
    return (
      aParts.containerPath === descriptor.containerPath &&
      bParts.containerPath === descriptor.containerPath &&
      aParts.source !== bParts.source
    );
  }
  if (kind === "argv.token") {
    return aToken === descriptor.argvFrom && bToken === descriptor.argvTo && aToken !== bToken;
  }
  return false;
}

export function evaluateSingleTokenDelta(
  aArgv: readonly string[],
  bArgv: readonly string[],
  descriptor: InterventionDescriptor,
): DeltaEvaluation {
  if (aArgv.length !== bArgv.length) {
    return {
      single_token_delta: false,
      delta_index: null,
      delta_valid: false,
      reason: "argv length differs",
    };
  }
  const differing: number[] = [];
  for (let index = 0; index < aArgv.length; index += 1) {
    if ((aArgv[index] ?? "") !== (bArgv[index] ?? "")) {
      differing.push(index);
    }
  }
  if (differing.length !== 1) {
    return {
      single_token_delta: false,
      delta_index: null,
      delta_valid: false,
      reason: `${differing.length} tokens differ`,
    };
  }
  const index = differing[0] ?? -1;
  const aToken = aArgv[index] ?? "";
  const bToken = bArgv[index] ?? "";
  const valid = validateKindSemantics(aToken, bToken, descriptor);
  return {
    single_token_delta: true,
    delta_index: index,
    delta_valid: valid,
    reason: valid ? "declared delta kind satisfied" : "delta tokens do not match the declared kind",
  };
}
