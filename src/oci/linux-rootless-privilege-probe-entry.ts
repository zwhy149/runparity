import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createCurrentNodeLinuxGuestPrivilegeProbeRuntime } from "./linux-rootless-privilege-probe-node-runtime.js";
import {
  assembleFixedLinuxGuestPrivilegeProbe,
  renderFixedLinuxGuestPrivilegeProbeResult,
} from "./linux-rootless-privilege-probe-program.js";

function runFixedLinuxGuestPrivilegeProbeEntry(): void {
  const argv = process.argv.slice(2);
  const runtime = argv.length === 0 ? createCurrentNodeLinuxGuestPrivilegeProbeRuntime() : null;
  const rendered = renderFixedLinuxGuestPrivilegeProbeResult(
    assembleFixedLinuxGuestPrivilegeProbe(argv, runtime),
  );

  if (rendered.stdout.length > 0) process.stdout.write(rendered.stdout);
  if (rendered.stderr.length > 0) process.stderr.write(rendered.stderr);
  process.exitCode = rendered.exitCode;
}

function isDirectExecution(entryPath: string, moduleUrl: string): boolean {
  try {
    return realpathSync.native(entryPath) === realpathSync.native(new URL(moduleUrl));
  } catch {
    return pathToFileURL(entryPath).href === moduleUrl;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && isDirectExecution(entryPath, import.meta.url)) {
  runFixedLinuxGuestPrivilegeProbeEntry();
}
