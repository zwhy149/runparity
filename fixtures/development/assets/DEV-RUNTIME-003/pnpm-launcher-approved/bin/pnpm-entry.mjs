// DEV-RUNTIME-003 minimal pnpm entry: implements only the frozen
// `run <script name>` surface the case needs. The launcher chain supplies the
// adjacent fixture identity RUNPARITY_FIXTURE_RUNTIME_ROLE; the child runs
// under the same Node with inherited stdio and environment, and PATH is left
// untouched by this entry.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [subcommand, scriptName] = process.argv.slice(2);
if (
  subcommand !== "run" ||
  typeof scriptName !== "string" ||
  !/^[A-Za-z0-9:_.-]+$/u.test(scriptName)
) {
  process.stderr.write("RP_FIXTURE_INVALID_PNPM_INVOCATION\n");
  process.exitCode = 64;
} else {
  let scriptValue = null;
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    scriptValue = manifest?.scripts?.[scriptName] ?? null;
  } catch {
    scriptValue = null;
  }
  const match =
    typeof scriptValue === "string" ? /^node\s+([A-Za-z0-9._/-]+)$/u.exec(scriptValue) : null;
  if (match === null) {
    process.stderr.write("RP_FIXTURE_INVALID_PNPM_INVOCATION\n");
    process.exitCode = 64;
  } else {
    const result = spawnSync(process.execPath, [match[1]], {
      stdio: "inherit",
      shell: false,
    });
    process.exitCode = result.error !== undefined ? 64 : (result.status ?? 64);
  }
}
