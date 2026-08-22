/**
 * Strict remote argv contract for the Linux backend transport.
 *
 * Every argument sent through the SSH transport is joined into one remote
 * command string that the remote login shell re-tokenizes. To keep that
 * re-tokenization inert, each argument must match an allowlist of characters
 * with no shell expansion semantics on POSIX sh/bash/dash: no whitespace, no
 * quotes, no dollar, no glob characters, no braces, no semicolons, no
 * parentheses, no redirection. Anything outside the allowlist is rejected
 * before a transport command is ever built — the transport never escapes or
 * interpolates, it only forwards already-safe tokens.
 */
export const REMOTE_ARG_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/u;

export const REMOTE_COMMAND_REJECTION = "RP_BACKEND_REMOTE_COMMAND_REJECTED" as const;

export function isSafeRemoteArg(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && REMOTE_ARG_PATTERN.test(value);
}

export function joinRemoteArgv(argv: readonly unknown[]): string {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error(`${REMOTE_COMMAND_REJECTION}: empty remote argv`);
  }
  const safe: string[] = [];
  for (const candidate of argv) {
    if (!isSafeRemoteArg(candidate)) {
      throw new Error(
        `${REMOTE_COMMAND_REJECTION}: argument ${safe.length} contains characters outside the remote allowlist`,
      );
    }
    safe.push(candidate);
  }
  return safe.join(" ");
}
