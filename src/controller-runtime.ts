export type ControllerWarning = {
  code: "RP_CONTROLLER_NODE_EOL" | "RP_CONTROLLER_NODE_UNRECOGNIZED";
  message: string;
};

export type ControllerRuntime = {
  name: "node";
  version: string;
  support_status: "supported_lts" | "supported_current" | "eol_compatibility" | "unrecognized";
  warning: ControllerWarning | null;
};

export function describeControllerRuntime(version: string): ControllerRuntime {
  const majorText = version.match(/^(\d+)\./)?.[1];
  const major = majorText === undefined ? Number.NaN : Number(majorText);
  if (!Number.isSafeInteger(major)) {
    return {
      name: "node",
      version,
      support_status: "unrecognized",
      warning: {
        code: "RP_CONTROLLER_NODE_UNRECOGNIZED",
        message: "RunParity could not classify the Node.js runtime used by its controller.",
      },
    };
  }

  if (major <= 20 || major % 2 === 1) {
    return {
      name: "node",
      version,
      support_status: "eol_compatibility",
      warning: {
        code: "RP_CONTROLLER_NODE_EOL",
        message:
          "RunParity supports this EOL Node.js line for diagnosis compatibility; use an active LTS line for normal development.",
      },
    };
  }

  return {
    name: "node",
    version,
    support_status: major === 22 || major === 24 ? "supported_lts" : "supported_current",
    warning: null,
  };
}
