import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { readEvidenceFile } from "./evidence-file.js";

export type LaunchKind = "native_executable" | "recognized_node_shim";

export type CandidateResolution = {
  searchPath: string;
  canonicalPath: string;
};

const MAX_CANDIDATE_RESOLUTIONS = 64;

export type LaunchPlan = {
  requestedProgram: string;
  selectedSearchPath: string;
  resolvedPath: string;
  kind: LaunchKind;
  executablePath: string;
  argv0: string;
  scriptPath: string | null;
  args: string[];
  candidates: string[];
  candidateResolutions: CandidateResolution[];
  candidateResolutionsTruncated: boolean;
  environmentMutations: {
    set: Record<string, string>;
    unset: string[];
  };
};

export type ResolutionContext = {
  platform?: NodeJS.Platform;
  cwd: string;
};

export class CommandResolutionError extends Error {
  readonly code:
    | "RP_COMMAND_NOT_FOUND"
    | "RP_COMMAND_NOT_EXECUTABLE"
    | "RP_UNVERIFIED_WINDOWS_SHIM";

  constructor(code: CommandResolutionError["code"], message: string) {
    super(message);
    this.name = "CommandResolutionError";
    this.code = code;
  }
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function canonicalFile(path: string): string {
  return realpathSync.native(path);
}

function existingCandidates(
  candidates: readonly string[],
  platform: NodeJS.Platform,
): {
  executable: string[];
  notExecutable: string[];
  resolutions: CandidateResolution[];
  resolutionsTruncated: boolean;
} {
  const seenExecutable = new Set<string>();
  const seenNotExecutable = new Set<string>();
  const seenSearchPaths = new Set<string>();
  const executable: string[] = [];
  const notExecutable: string[] = [];
  const resolutions: CandidateResolution[] = [];
  let resolutionsTruncated = false;
  for (const candidate of candidates) {
    const searchIdentity = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seenSearchPaths.has(searchIdentity)) continue;
    seenSearchPaths.add(searchIdentity);
    if (!isFile(candidate)) continue;
    const canonical = canonicalFile(candidate);
    const identity = platform === "win32" ? canonical.toLowerCase() : canonical;
    if (platform !== "win32") {
      try {
        accessSync(canonical, constants.X_OK);
      } catch {
        if (!seenNotExecutable.has(identity)) {
          seenNotExecutable.add(identity);
          notExecutable.push(canonical);
        }
        continue;
      }
    }
    if (resolutions.length < MAX_CANDIDATE_RESOLUTIONS) {
      resolutions.push({ searchPath: candidate, canonicalPath: canonical });
    } else {
      resolutionsTruncated = true;
    }
    if (seenExecutable.has(identity)) continue;
    seenExecutable.add(identity);
    executable.push(canonical);
  }
  return { executable, notExecutable, resolutions, resolutionsTruncated };
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const entry = Object.entries(environment)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))[0];
  return entry?.[1];
}

function windowsCandidates(program: string, environment: NodeJS.ProcessEnv, cwd: string): string[] {
  const hasDirectory = /[\\/]/.test(program);
  const searchCurrentDirectory = !hasDirectory;
  const pathEntries = hasDirectory
    ? [""]
    : [
        ...(searchCurrentDirectory ? [cwd] : []),
        ...(environmentValue(environment, "PATH") ?? "")
          .split(";")
          .filter((entry) => entry.length > 0),
      ];
  const extensions = extname(program)
    ? [""]
    : (environmentValue(environment, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter((entry) => entry.length > 0);

  return pathEntries.flatMap((pathEntry) =>
    extensions.map((extension) => {
      const candidate = `${program}${extension}`;
      return hasDirectory
        ? isAbsolute(candidate)
          ? resolve(candidate)
          : resolve(cwd, candidate)
        : resolve(isAbsolute(pathEntry) ? pathEntry : resolve(cwd, pathEntry), candidate);
    }),
  );
}

function appendPosixLiteralPath(directory: string, value: string): string {
  const separator = directory.endsWith("/") ? "" : "/";
  return `${directory}${separator}${value}`;
}

function absolutePosixLiteralPath(value: string, cwd: string): string {
  return value.startsWith("/") ? value : appendPosixLiteralPath(cwd, value);
}

function posixCandidates(program: string, environment: NodeJS.ProcessEnv, cwd: string): string[] {
  if (program.includes("/")) {
    return [absolutePosixLiteralPath(program, cwd)];
  }

  const path = environment["PATH"] ?? "/usr/bin:/bin";
  return path.split(":").map((entry) => {
    const directory = entry.length === 0 ? cwd : absolutePosixLiteralPath(entry, cwd);
    return appendPosixLiteralPath(directory, program);
  });
}

function expandShimPath(value: string, shimDirectory: string, cwd: string): string {
  const expanded = value.replace(/%~dp0/gi, `${shimDirectory}\\`);
  if (expanded.includes("%")) {
    throw new CommandResolutionError(
      "RP_UNVERIFIED_WINDOWS_SHIM",
      "The command shim depends on dynamic batch variables and cannot be executed safely.",
    );
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function readBoundedShimSource(shimPath: string): string {
  const file = readEvidenceFile({ role: "resolved_launcher", path: shimPath });
  if (!file.ok) {
    const message =
      file.reason === "too_large"
        ? "The command shim is too large to match a supported forwarding template."
        : "The command shim could not be read as a supported forwarding template.";
    throw new CommandResolutionError("RP_UNVERIFIED_WINDOWS_SHIM", message);
  }
  return file.bytes.toString("utf8");
}

function setCaseInsensitive(target: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(target).find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing !== undefined) delete target[existing];
  target[name] = value;
}

function removeCaseInsensitive(values: string[], name: string): void {
  const existing = values.findIndex((value) => value.toLowerCase() === name.toLowerCase());
  if (existing !== -1) values.splice(existing, 1);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || (codePoint >= 127 && codePoint <= 159)) return true;
  }
  return false;
}

function parseVerifiedNodeShim(
  matchedShimPath: string,
  canonicalShimPath: string,
  targetArgs: string[],
  source: string,
  cwd: string,
): LaunchPlan {
  const environmentMutations: LaunchPlan["environmentMutations"] = { set: {}, unset: [] };
  let state: "preamble" | "assignments" | "forwarded" | "terminated" = "preamble";
  let sawEchoOff = false;
  let sawSetlocal = false;
  let forwarding: RegExpMatchArray | null = null;
  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/^(?:::|rem(?:\s|$))/i.test(line)) {
      if (/[&|<>^%!()]/u.test(line) || hasControlCharacters(line)) {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim contains a comment with batch metacharacters.",
        );
      }
      continue;
    }
    if (/^@?echo\s+off$/i.test(line)) {
      if (state !== "preamble" || sawEchoOff) {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim preamble is not in a supported order.",
        );
      }
      sawEchoOff = true;
      continue;
    }
    if (/^setlocal$/i.test(line)) {
      if (state !== "preamble" || sawSetlocal) {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim preamble is not in a supported order.",
        );
      }
      sawSetlocal = true;
      state = "assignments";
      continue;
    }
    const assignment = line.match(/^set\s+"([A-Za-z_][A-Za-z0-9_]*)=([^"\r\n]*)"$/i);
    if (assignment?.[1] !== undefined && assignment[2] !== undefined) {
      if (state === "forwarded" || state === "terminated") {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim mutates its environment after forwarding.",
        );
      }
      state = "assignments";
      if (
        assignment[2].includes("%") ||
        assignment[2].includes("!") ||
        hasControlCharacters(assignment[2])
      ) {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim contains a dynamic environment assignment that is not supported.",
        );
      }
      removeCaseInsensitive(environmentMutations.unset, assignment[1]);
      if (assignment[2].length === 0) {
        const existing = Object.keys(environmentMutations.set).find(
          (key) => key.toLowerCase() === assignment[1]?.toLowerCase(),
        );
        if (existing !== undefined) delete environmentMutations.set[existing];
        environmentMutations.unset.push(assignment[1]);
      } else {
        setCaseInsensitive(environmentMutations.set, assignment[1], assignment[2]);
      }
      continue;
    }

    const forwardingMatch = line.match(/^"([^"]+)"\s+"([^"]+)"\s+%\*$/i);
    if (forwardingMatch !== null) {
      if (state === "forwarded" || state === "terminated" || forwarding !== null) {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim contains more than one forwarding instruction.",
        );
      }
      forwarding = forwardingMatch;
      state = "forwarded";
      continue;
    }
    if (/^exit\s+\/b\s+%errorlevel%$/i.test(line)) {
      if (state !== "forwarded") {
        throw new CommandResolutionError(
          "RP_UNVERIFIED_WINDOWS_SHIM",
          "The command shim exits before its forwarding instruction.",
        );
      }
      state = "terminated";
      continue;
    }

    throw new CommandResolutionError(
      "RP_UNVERIFIED_WINDOWS_SHIM",
      "The command is an unknown batch program, not a recognized Node forwarding shim.",
    );
  }

  if (forwarding?.[1] === undefined || forwarding[2] === undefined) {
    throw new CommandResolutionError(
      "RP_UNVERIFIED_WINDOWS_SHIM",
      "The command shim does not contain exactly one supported Node forwarding instruction.",
    );
  }

  const shimDirectory = dirname(matchedShimPath);
  const executablePath = expandShimPath(forwarding[1], shimDirectory, cwd);
  const scriptPath = expandShimPath(forwarding[2], shimDirectory, cwd);
  if (basename(executablePath).toLowerCase() !== "node.exe" || !isFile(executablePath)) {
    throw new CommandResolutionError(
      "RP_UNVERIFIED_WINDOWS_SHIM",
      "The command shim does not resolve to an existing node.exe.",
    );
  }
  if (!/\.(?:c?js|mjs)$/i.test(scriptPath) || !isFile(scriptPath)) {
    throw new CommandResolutionError(
      "RP_UNVERIFIED_WINDOWS_SHIM",
      "The command shim does not resolve to an existing JavaScript entry point.",
    );
  }

  return {
    requestedProgram: basename(matchedShimPath, extname(matchedShimPath)),
    selectedSearchPath: matchedShimPath,
    resolvedPath: canonicalShimPath,
    kind: "recognized_node_shim",
    executablePath,
    argv0: executablePath,
    scriptPath,
    args: [scriptPath, ...targetArgs],
    candidates: [canonicalShimPath],
    candidateResolutions: [{ searchPath: matchedShimPath, canonicalPath: canonicalShimPath }],
    candidateResolutionsTruncated: false,
    environmentMutations,
  };
}

function officialNpmSource(
  commandName: "npm.cmd" | "npx.cmd",
  family: "legacy" | "current",
): string {
  const isNpx = commandName === "npx.cmd";
  const variable = isNpx ? "NPX_CLI_JS" : "NPM_CLI_JS";
  const scriptName = isNpx ? "npx-cli.js" : "npm-cli.js";
  const prefixVariable = isNpx ? "NPM_PREFIX_NPX_CLI_JS" : "NPM_PREFIX_NPM_CLI_JS";
  const resolverSetup =
    family === "current"
      ? ['SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"']
      : isNpx
        ? ['SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"']
        : [];
  const resolverInvocation =
    family === "current"
      ? 'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"'
      : 'CALL "%NODE_EXE%" "%NPM_CLI_JS%" prefix -g';
  return [
    ":: Created by npm, please don't edit manually.",
    "@ECHO OFF",
    "",
    "SETLOCAL",
    "",
    'SET "NODE_EXE=%~dp0\\node.exe"',
    'IF NOT EXIST "%NODE_EXE%" (',
    '  SET "NODE_EXE=node"',
    ")",
    "",
    ...resolverSetup,
    `SET "${variable}=%~dp0\\node_modules\\npm\\bin\\${scriptName}"`,
    `FOR /F "delims=" %%F IN ('${resolverInvocation}') DO (`,
    `  SET "${prefixVariable}=%%F\\node_modules\\npm\\bin\\${scriptName}"`,
    ")",
    `IF EXIST "%${prefixVariable}%" (`,
    `  SET "${variable}=%${prefixVariable}%"`,
    ")",
    "",
    `"%NODE_EXE%" "%${variable}%" %*`,
  ].join("\n");
}

function normalizeShimSource(source: string): string {
  const normalized = source.replaceAll("\r\n", "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

function refuseUnsupervisedOfficialNpmShim(shimPath: string, source: string): null {
  const commandName = basename(shimPath).toLowerCase() as "npm.cmd" | "npx.cmd";
  if (commandName !== "npm.cmd" && commandName !== "npx.cmd") return null;

  const normalizedSource = normalizeShimSource(source);
  const family = (["current", "legacy"] as const).find(
    (candidate) => normalizedSource === officialNpmSource(commandName, candidate),
  );
  if (family === undefined) return null;

  throw new CommandResolutionError(
    "RP_UNVERIFIED_WINDOWS_SHIM",
    `The recognized npm ${family} shim requires a prefix-selection stage that is not yet executed under RunParity's timeout and cleanup supervision.`,
  );
}

export function resolveLaunch(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  context: ResolutionContext,
): LaunchPlan {
  const [program, ...targetArgs] = argv;
  if (program === undefined) {
    throw new CommandResolutionError(
      "RP_COMMAND_NOT_FOUND",
      "A target command is required after --.",
    );
  }

  const platform = context.platform ?? process.platform;
  const cwd = context.cwd;
  const candidates =
    platform === "win32"
      ? windowsCandidates(program, environment, cwd)
      : posixCandidates(program, environment, cwd);
  const scanned = existingCandidates(candidates, platform);
  const matches = scanned.executable;
  const resolvedPath = matches[0];
  if (resolvedPath === undefined) {
    if (scanned.notExecutable.length > 0) {
      throw new CommandResolutionError(
        "RP_COMMAND_NOT_EXECUTABLE",
        `Command was found on PATH but is not executable: ${program}`,
      );
    }
    throw new CommandResolutionError(
      "RP_COMMAND_NOT_FOUND",
      `Command not found on PATH: ${program}`,
    );
  }
  const selectedSearchPath = scanned.resolutions[0]?.searchPath ?? resolvedPath;
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(resolvedPath)) {
    const source = readBoundedShimSource(resolvedPath);
    const plan =
      refuseUnsupervisedOfficialNpmShim(resolvedPath, source) ??
      parseVerifiedNodeShim(selectedSearchPath, resolvedPath, targetArgs, source, cwd);
    return {
      ...plan,
      requestedProgram: program,
      selectedSearchPath,
      candidates: matches,
      candidateResolutions: scanned.resolutions,
      candidateResolutionsTruncated: scanned.resolutionsTruncated,
    };
  }

  return {
    requestedProgram: program,
    selectedSearchPath,
    resolvedPath,
    kind: "native_executable",
    executablePath: resolvedPath,
    argv0: program,
    scriptPath: null,
    args: targetArgs,
    candidates: matches,
    candidateResolutions: scanned.resolutions,
    candidateResolutionsTruncated: scanned.resolutionsTruncated,
    environmentMutations: { set: {}, unset: [] },
  };
}
