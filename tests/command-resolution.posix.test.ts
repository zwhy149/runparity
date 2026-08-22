import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type CommandResolutionError, resolveLaunch } from "../src/command-resolution.js";

const temporaryDirectories: string[] = [];

function project(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("POSIX command resolution semantics", () => {
  test("does not case-fold Path into PATH", () => {
    const cwd = project("runparity-posix-path-case-");

    expect(() =>
      resolveLaunch(["missing-probe"], { Path: cwd }, { platform: "linux", cwd }),
    ).toThrowError(
      expect.objectContaining<Partial<CommandResolutionError>>({ code: "RP_COMMAND_NOT_FOUND" }),
    );
  });

  test("treats an empty PATH component as the working directory", () => {
    const cwd = project("runparity-posix-empty-path-");
    const executable = resolve(cwd, "cwd-probe");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    const launch = resolveLaunch(["cwd-probe"], { PATH: "" }, { platform: "linux", cwd });
    // CI runners expose temp dirs in 8.3 short-name form; compare canonical
    // realpaths instead of raw spellings.
    expect(realpathSync.native(launch.resolvedPath ?? "")).toBe(realpathSync.native(executable));
    expect(realpathSync.native(launch.executablePath ?? "")).toBe(realpathSync.native(executable));
  });

  describe.runIf(process.platform !== "win32")("default PATH", () => {
    test("uses Node's /usr/bin:/bin fallback when PATH is absent", () => {
      const cwd = project("runparity-posix-default-path-");

      expect(resolveLaunch(["sh"], {}, { platform: process.platform, cwd }).resolvedPath).toMatch(
        /^\/(?:usr\/)?bin\//u,
      );
    });
  });

  describe.runIf(process.platform !== "win32")("executable permission", () => {
    test("treats a trailing backslash in a PATH directory as a literal filename character", () => {
      const cwd = project("runparity-posix-backslash-path-");
      const literalDirectory = `${cwd}/bin\\`;
      const expectedProbe = `${literalDirectory}/probe`;
      const collapsedProbe = `${cwd}/bin\\probe`;
      mkdirSync(literalDirectory);
      writeFileSync(expectedProbe, "#!/bin/sh\nprintf GOOD_NATIVE\n");
      writeFileSync(collapsedProbe, "#!/bin/sh\nprintf WRONG_COLLAPSED\n");
      chmodSync(expectedProbe, 0o755);
      chmodSync(collapsedProbe, 0o755);

      const native = spawnSync("probe", [], {
        cwd,
        encoding: "utf8",
        env: { PATH: literalDirectory },
        shell: false,
      });
      const launch = resolveLaunch(
        ["probe"],
        { PATH: literalDirectory },
        { platform: process.platform, cwd },
      );
      const runParityTarget = spawnSync(launch.executablePath, launch.args, {
        cwd,
        encoding: "utf8",
        env: { PATH: literalDirectory },
        argv0: launch.argv0,
        shell: false,
      });

      expect(native.stdout).toBe("GOOD_NATIVE");
      expect(launch.selectedSearchPath).toBe(expectedProbe);
      expect(launch.resolvedPath).toBe(realpathSync.native(expectedProbe));
      expect(runParityTarget.stdout).toBe("GOOD_NATIVE");
    });

    test("preserves symlink-sensitive parent segments for PATH and explicit lookups", () => {
      const cwd = project("runparity-posix-symlink-parent-");
      const logical = resolve(cwd, "logical");
      const physical = resolve(cwd, "physical");
      const physicalChild = resolve(physical, "child");
      const link = resolve(logical, "link");
      mkdirSync(logical);
      mkdirSync(physicalChild, { recursive: true });
      symlinkSync(physicalChild, link, "dir");
      const logicalProbe = resolve(logical, "probe");
      const physicalProbe = resolve(physical, "probe");
      writeFileSync(logicalProbe, "#!/bin/sh\nexit 41\n");
      writeFileSync(physicalProbe, "#!/bin/sh\nexit 42\n");
      chmodSync(logicalProbe, 0o755);
      chmodSync(physicalProbe, 0o755);

      const literalDirectory = `${link}/..`;
      const literalCandidate = `${literalDirectory}/probe`;
      const fromPath = resolveLaunch(
        ["probe"],
        { PATH: literalDirectory },
        { platform: process.platform, cwd },
      );
      const fromExplicit = resolveLaunch(
        ["logical/link/../probe"],
        {},
        { platform: process.platform, cwd },
      );

      expect(fromPath.selectedSearchPath).toBe(literalCandidate);
      expect(fromPath.resolvedPath).toBe(realpathSync.native(physicalProbe));
      expect(fromExplicit.selectedSearchPath).toBe(`${cwd}/logical/link/../probe`);
      expect(fromExplicit.resolvedPath).toBe(realpathSync.native(physicalProbe));
    });

    test("skips an earlier non-executable PATH file", () => {
      const cwd = project("runparity-posix-xok-");
      const first = resolve(cwd, "first");
      const second = resolve(cwd, "second");
      mkdirSync(first);
      mkdirSync(second);
      writeFileSync(resolve(first, "probe"), "not executable\n");
      chmodSync(resolve(first, "probe"), 0o644);
      writeFileSync(resolve(second, "probe"), "#!/bin/sh\nexit 0\n");
      chmodSync(resolve(second, "probe"), 0o755);

      expect(
        resolveLaunch(
          ["probe"],
          { PATH: [first, second].join(delimiter) },
          { platform: process.platform, cwd },
        ).resolvedPath,
      ).toBe(resolve(second, "probe"));
    });

    test("returns a typed error when every candidate is non-executable", () => {
      const cwd = project("runparity-posix-eacces-");
      const bin = resolve(cwd, "bin");
      mkdirSync(bin);
      writeFileSync(resolve(bin, "probe"), "not executable\n");
      chmodSync(resolve(bin, "probe"), 0o644);

      expect(() =>
        resolveLaunch(["probe"], { PATH: bin }, { platform: process.platform, cwd }),
      ).toThrowError(
        expect.objectContaining<Partial<CommandResolutionError>>({
          code: "RP_COMMAND_NOT_EXECUTABLE",
        }),
      );
    });
  });
});
