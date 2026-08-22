// DEV-OOS-001 fixture: read-only Windows registry probe.
//
// The probe queries one deterministic, fixture-specific absent HKLM value with
// reg.exe and never creates, deletes, or mutates registry state or system PATH.
// On hosts without a Windows registry the probe refuses with an invalid marker
// instead of fabricating a registry outcome.
import { spawnSync } from "node:child_process";

const suppliedRegExe = process.env.RUNPARITY_FIXTURE_REG_EXE;
const systemRoot = process.env.SystemRoot;
const regExe =
  suppliedRegExe !== undefined && suppliedRegExe !== ""
    ? suppliedRegExe
    : process.platform === "win32" && typeof systemRoot === "string" && systemRoot !== ""
      ? `${systemRoot}\\System32\\reg.exe`
      : null;
if (regExe === null) {
  process.stderr.write("RP_FIXTURE_INVALID_REGISTRY_ASSERTION\n");
  process.exitCode = 64;
} else {
  const queryArgs = ["query", "HKLM\\SOFTWARE\\RunParity\\Fixture", "/v", "MissingValue"];
  const result = /\.(?:cjs|mjs)$/u.test(regExe)
    ? spawnSync(process.execPath, [regExe, ...queryArgs], { encoding: "utf8", shell: false })
    : spawnSync(regExe, queryArgs, { encoding: "utf8", shell: false });
  if (result.error !== undefined || result.status === null) {
    process.stderr.write("RP_FIXTURE_INVALID_REGISTRY_ASSERTION\n");
    process.exitCode = 64;
  } else if (result.status === 1) {
    // The absent-key query failed, exactly as the frozen premise requires.
    process.stderr.write("RP_FIXTURE_WINDOWS_PRIVILEGED_REGISTRY\n");
    process.exitCode = 23;
  } else {
    // The key exists: the fixture premise is violated on this host.
    process.stderr.write("RP_FIXTURE_INVALID_REGISTRY_ASSERTION\n");
    process.exitCode = 64;
  }
}
