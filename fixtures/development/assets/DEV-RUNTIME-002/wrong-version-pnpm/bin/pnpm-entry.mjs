// DEV-RUNTIME-002 minimal pnpm entry: implements only the frozen
// `exec node <script>` surface the case needs. The launcher chain supplies the
// adjacent fixture identity RUNPARITY_FIXTURE_MANAGER_VERSION; the child runs
// under the same externally supplied Node with inherited stdio and environment.
import { spawnSync } from "node:child_process";

const [subcommand, tool, script] = process.argv.slice(2);
if (
  subcommand !== "exec" ||
  tool !== "node" ||
  typeof script !== "string" ||
  !/^[A-Za-z0-9._/-]+$/u.test(script)
) {
  process.stderr.write("RP_FIXTURE_INVALID_PNPM_INVOCATION\n");
  process.exitCode = 64;
} else {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    shell: false,
  });
  process.exitCode = result.error !== undefined ? 64 : (result.status ?? 64);
}
