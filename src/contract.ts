import { createHash } from "node:crypto";
import { readEvidenceFile } from "./evidence-file.js";

const PACKAGE_JSON_PARSER = "runparity.package-json/v1";

type ConstraintSubject = "node_runtime" | "package_manager";
type ConstraintStrength = "required" | "advisory";

export type ContractConstraint = {
  subject: ConstraintSubject;
  name: string;
  selector: string;
  strength: ConstraintStrength;
  provenance: {
    file: string;
    pointer: string;
    projection_sha256: string;
    parser_version: typeof PACKAGE_JSON_PARSER;
  };
};

export type UnresolvedConstraint = {
  file: string;
  pointer: string;
  reason_code: string;
};

export type CompiledContract = {
  status: "compiled" | "partial";
  constraints: ContractConstraint[];
  unresolved: UnresolvedConstraint[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provenance(pointer: string, value: string): ContractConstraint["provenance"] {
  const projection = JSON.stringify({
    parser_version: PACKAGE_JSON_PARSER,
    pointer,
    value,
  });
  return {
    file: "package.json",
    pointer,
    projection_sha256: createHash("sha256").update(projection).digest("hex"),
    parser_version: PACKAGE_JSON_PARSER,
  };
}

export function compileContract(root: string): CompiledContract {
  const packageJson = readEvidenceFile({ role: "workspace_contract", root });
  if (!packageJson.ok && packageJson.reason === "missing") {
    return { status: "compiled", constraints: [], unresolved: [] };
  }
  if (!packageJson.ok) {
    const reasonCode = {
      missing: "RP_CONTRACT_FILE_UNREADABLE",
      unsafe_type: "RP_CONTRACT_UNSAFE_FILE",
      outside_workspace: "RP_CONTRACT_UNSAFE_FILE",
      too_large: "RP_CONTRACT_FILE_TOO_LARGE",
      changed_during_read: "RP_CONTRACT_FILE_CHANGED_DURING_READ",
      unreadable: "RP_CONTRACT_FILE_UNREADABLE",
    }[packageJson.reason];
    return {
      status: "partial",
      constraints: [],
      unresolved: [
        {
          file: "package.json",
          pointer: "",
          reason_code: reasonCode,
        },
      ],
    };
  }
  const bytes = packageJson.bytes;

  let manifest: unknown;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    return {
      status: "partial",
      constraints: [],
      unresolved: [
        {
          file: "package.json",
          pointer: "",
          reason_code: "RP_CONTRACT_INVALID_JSON",
        },
      ],
    };
  }
  if (!isRecord(manifest)) {
    return {
      status: "partial",
      constraints: [],
      unresolved: [
        {
          file: "package.json",
          pointer: "",
          reason_code: "RP_CONTRACT_INVALID_SHAPE",
        },
      ],
    };
  }

  const constraints: ContractConstraint[] = [];
  const unresolved: UnresolvedConstraint[] = [];

  const packageManager = manifest["packageManager"];
  if (typeof packageManager === "string") {
    const match = packageManager.match(/^([a-z0-9._-]+)@(.+)$/i);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      constraints.push({
        subject: "package_manager",
        name: match[1],
        selector: match[2],
        strength: "required",
        provenance: provenance("/packageManager", packageManager),
      });
    } else {
      unresolved.push({
        file: "package.json",
        pointer: "/packageManager",
        reason_code: "RP_CONTRACT_INVALID_PACKAGE_MANAGER",
      });
    }
  }

  const engines = manifest["engines"];
  if (isRecord(engines) && typeof engines["node"] === "string") {
    constraints.push({
      subject: "node_runtime",
      name: "node",
      selector: engines["node"],
      strength: "advisory",
      provenance: provenance("/engines/node", engines["node"]),
    });
  }

  return {
    status: unresolved.length === 0 ? "compiled" : "partial",
    constraints,
    unresolved,
  };
}
