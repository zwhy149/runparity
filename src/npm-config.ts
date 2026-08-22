import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readEvidenceFile } from "./evidence-file.js";

const SUPPORTED_BOOLEAN_KEYS = ["fund", "strict-peer-deps"] as const;

type SupportedBooleanKey = (typeof SUPPORTED_BOOLEAN_KEYS)[number];
type ConfigSource = "cli" | "environment" | "project_npmrc";

export type NpmConfigSourceEvidence = {
  source: ConfigSource;
  value: boolean;
  provenance: {
    argv_index: number | null;
    environment_variable: string | null;
    file: ".npmrc" | null;
    line: number | null;
    projection_sha256: string | null;
  };
};

export type NpmConfigSourceConflict = {
  command_shape: "npm_like";
  key: SupportedBooleanKey;
  values_conflict: true;
  semantics: "unqualified";
  sources: NpmConfigSourceEvidence[];
};

type ProjectNpmrc = {
  values: Map<SupportedBooleanKey, { value: boolean; line: number; projectionSha256: string }>;
};

function parseBoolean(value: string, emptyIsTrue: boolean): boolean | null {
  if (value === "") return emptyIsTrue ? true : null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function supportedKey(value: string): SupportedBooleanKey | null {
  return SUPPORTED_BOOLEAN_KEYS.find((key) => key === value) ?? null;
}

function readProjectNpmrc(cwd: string): ProjectNpmrc | null {
  const file = readEvidenceFile({ role: "workspace_config", root: cwd });
  if (!file.ok) return null;
  const values = new Map<
    SupportedBooleanKey,
    { value: boolean; line: number; projectionSha256: string }
  >();
  const lines = file.bytes.toString("utf8").replaceAll("\r\n", "\n").split("\n");
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    const assignment = line.match(/^([a-z][a-z0-9_-]*)\s*=\s*(.*?)\s*$/u);
    if (assignment?.[1] === undefined || assignment[2] === undefined) continue;
    const key = supportedKey(assignment[1]);
    const value = parseBoolean(assignment[2], true);
    if (key !== null && value !== null) {
      const projection = JSON.stringify({
        parser_version: "runparity.npmrc-boolean/v1",
        key,
        value,
      });
      values.set(key, {
        value,
        line: index + 1,
        projectionSha256: createHash("sha256").update(projection).digest("hex"),
      });
    }
  }
  return { values };
}

function cliValues(argv: readonly string[]): Map<SupportedBooleanKey, NpmConfigSourceEvidence> {
  const values = new Map<SupportedBooleanKey, NpmConfigSourceEvidence>();
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--") break;
    const match = argument.match(/^--(no-)?(fund|strict-peer-deps)(?:=(true|false))?$/u);
    if (match?.[2] === undefined) continue;
    const key = supportedKey(match[2]);
    if (key === null) continue;
    const flagIndex = index;
    const next = argv[index + 1];
    let rawValue = true;
    if (match[3] !== undefined) {
      rawValue = match[3] === "true";
    } else if (next === "true" || next === "false") {
      rawValue = next === "true";
      index += 1;
    }
    const value = match[1] === undefined ? rawValue : !rawValue;
    values.set(key, {
      source: "cli",
      value,
      provenance: {
        argv_index: flagIndex,
        environment_variable: null,
        file: null,
        line: null,
        projection_sha256: null,
      },
    });
  }
  return values;
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  expectedName: string,
): { name: string; value: string } | null {
  const entries = Object.entries(environment).filter(
    ([name, value]) => value !== undefined && name.toLowerCase() === expectedName,
  ) as Array<[string, string]>;
  const selected = entries.find(([name]) => name === expectedName) ?? entries[0];
  return selected === undefined ? null : { name: selected[0], value: selected[1] };
}

function environmentValues(
  environment: NodeJS.ProcessEnv,
): Map<SupportedBooleanKey, NpmConfigSourceEvidence> {
  const values = new Map<SupportedBooleanKey, NpmConfigSourceEvidence>();
  for (const key of SUPPORTED_BOOLEAN_KEYS) {
    const expectedName = `npm_config_${key.replaceAll("-", "_")}`;
    const entry = environmentValue(environment, expectedName);
    const value = entry === null ? null : parseBoolean(entry.value, false);
    if (entry === null || value === null) continue;
    values.set(key, {
      source: "environment",
      value,
      provenance: {
        argv_index: null,
        environment_variable: entry.name,
        file: null,
        line: null,
        projection_sha256: null,
      },
    });
  }
  return values;
}

function isNpmCommand(program: string | undefined): boolean {
  if (program === undefined) return false;
  const command = basename(program)
    .toLowerCase()
    .replace(/\.(?:bat|cmd|exe)$/u, "");
  return command === "npm" || command === "npx";
}

function usesUnsupportedGlobalMode(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): boolean {
  const globalEnvironment = environmentValue(environment, "npm_config_global");
  if (globalEnvironment !== null && parseBoolean(globalEnvironment.value, false) === true) {
    return true;
  }
  if (environmentValue(environment, "npm_config_location")?.value === "global") {
    return true;
  }
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") break;
    if (argument === "--global" || argument === "-g" || argument === "--location=global") {
      return true;
    }
    if (argument === "--global=true" || argument === "-g=true") return true;
    if (argument === "--location" && argv[index + 1] === "global") return true;
  }
  return false;
}

export function observeNpmConfigSourceConflicts(
  argv: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): NpmConfigSourceConflict[] {
  if (!isNpmCommand(argv[0]) || usesUnsupportedGlobalMode(argv, environment)) return [];
  const cli = cliValues(argv);
  const env = environmentValues(environment);
  const project = readProjectNpmrc(cwd);
  const conflicts: NpmConfigSourceConflict[] = [];

  for (const key of SUPPORTED_BOOLEAN_KEYS) {
    const sources: NpmConfigSourceEvidence[] = [];
    const cliEvidence = cli.get(key);
    const environmentEvidence = env.get(key);
    const projectValue = project?.values.get(key);
    if (cliEvidence !== undefined) sources.push(cliEvidence);
    if (environmentEvidence !== undefined) sources.push(environmentEvidence);
    if (projectValue !== undefined && project !== null) {
      sources.push({
        source: "project_npmrc",
        value: projectValue.value,
        provenance: {
          argv_index: null,
          environment_variable: null,
          file: ".npmrc",
          line: projectValue.line,
          projection_sha256: projectValue.projectionSha256,
        },
      });
    }
    if (sources.length < 2 || new Set(sources.map((source) => source.value)).size < 2) continue;
    conflicts.push({
      command_shape: "npm_like",
      key,
      values_conflict: true,
      semantics: "unqualified",
      sources,
    });
  }

  return conflicts;
}
