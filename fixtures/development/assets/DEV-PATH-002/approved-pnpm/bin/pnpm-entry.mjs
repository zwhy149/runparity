// DEV-PATH-002 minimal pnpm entry: implements only the frozen
// `exec node <script>` surface the case needs. The approved launcher chain
// stamps the child with the approved marker; the stale launcher chain never
// reaches this entry because its Node entry target does not exist.
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
    env: { ...process.env, RUNPARITY_FIXTURE_PNPM_MARKER: "approved" },
    shell: false,
  });
  process.exitCode = result.error !== undefined ? 64 : (result.status ?? 64);
}
