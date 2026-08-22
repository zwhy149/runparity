// DEV-CONFIG-002 fixture: assert the effective npm boolean for
// `strict-peer-deps`.
//
// A real npm lifecycle run does not export file-sourced configuration to the
// script environment, so the assertion asks a real `npm config get` invocation
// for the effective value and compares it against the frozen expected isolated
// user value `strict-peer-deps=false`. In A arms the project .npmrc value
// `true` wins under real npm precedence and the assertion fails. No registry
// contact or file mutation happens here.
import { spawnSync } from "node:child_process";

function npmConfigGet(key, extraArgs = []) {
  const cli = process.env.RUNPARITY_FIXTURE_NPM_CLI;
  if (cli === undefined || cli === "") {
    return spawnSync("npm", ["config", "get", key, ...extraArgs], {
      encoding: "utf8",
      shell: false,
    });
  }
  if (/\.(?:c?js|mjs)$/u.test(cli)) {
    return spawnSync(process.execPath, [cli, "config", "get", key, ...extraArgs], {
      encoding: "utf8",
      shell: false,
    });
  }
  return spawnSync(cli, ["config", "get", key, ...extraArgs], {
    encoding: "utf8",
    shell: false,
  });
}

const effective = npmConfigGet("strict-peer-deps");
if (effective.error !== undefined || effective.status !== 0) {
  process.stderr.write("RP_FIXTURE_INVALID_CONFIG_ASSERTION\n");
  process.exitCode = 64;
} else if (effective.stdout.trim() === "false") {
  process.stdout.write("RUNPARITY_OK:dev-config-002\n");
  process.exitCode = 0;
} else if (effective.stdout.trim() === "true") {
  process.stderr.write("RP_FIXTURE_PROJECT_OVERRIDES_USER_NPMRC\n");
  process.exitCode = 23;
} else {
  process.stderr.write("RP_FIXTURE_INVALID_CONFIG_ASSERTION\n");
  process.exitCode = 64;
}
