// DEV-CONFIG-003 fixture: assert the effective npm boolean for `fund` when one
// CLI config flag is present in the forwarded target argv.
//
// Real npm forwards arguments after `--` to the lifecycle script instead of
// applying them as its own config, so the frozen A-arm argv forwards the
// contradictory flag `--fund=false` to this script. The assertion then asks a
// real `npm config get fund <flag>` invocation for the effective value: the
// inner npm applies real CLI-over-environment precedence, which must fail the
// frozen expected environment value `fund=true`. No registry contact or file
// mutation happens here.
import { spawnSync } from "node:child_process";

const forwardedArgs = process.argv.slice(2);
const flag =
  forwardedArgs.length === 1 && /^--fund=(?:true|false)$/u.test(forwardedArgs[0])
    ? forwardedArgs[0]
    : null;
if (flag === null) {
  process.stderr.write("RP_FIXTURE_INVALID_CONFIG_ASSERTION\n");
  process.exitCode = 64;
} else {
  const cli = process.env.RUNPARITY_FIXTURE_NPM_CLI;
  const spawnArgs = ["config", "get", "fund", flag];
  const effective =
    cli === undefined || cli === ""
      ? spawnSync("npm", spawnArgs, { encoding: "utf8", shell: false })
      : /\.(?:c?js|mjs)$/u.test(cli)
        ? spawnSync(process.execPath, [cli, ...spawnArgs], { encoding: "utf8", shell: false })
        : spawnSync(cli, spawnArgs, { encoding: "utf8", shell: false });
  if (effective.error !== undefined || effective.status !== 0) {
    process.stderr.write("RP_FIXTURE_INVALID_CONFIG_ASSERTION\n");
    process.exitCode = 64;
  } else if (effective.stdout.trim() === "true") {
    process.stdout.write("RUNPARITY_OK:dev-config-003\n");
    process.exitCode = 0;
  } else if (effective.stdout.trim() === "false") {
    process.stderr.write("RP_FIXTURE_CLI_OVERRIDES_ENV_CONFIG\n");
    process.exitCode = 23;
  } else {
    process.stderr.write("RP_FIXTURE_INVALID_CONFIG_ASSERTION\n");
    process.exitCode = 64;
  }
}
