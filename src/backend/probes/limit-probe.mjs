// RunParity backend qualification probe: effective resource limit facts.
import { readFileSync } from "node:fs";

function boundedRead(path, maxBytes) {
  try {
    const buffer = readFileSync(path);
    if (buffer.length > maxBytes) {
      return { state: "oversize", bytes: buffer.length };
    }
    return { state: "observed", text: buffer.toString("utf8") };
  } catch (error) {
    return {
      state: "missing",
      error_code: error instanceof Error && typeof error.code === "string" ? error.code : "UNKNOWN",
    };
  }
}

function parseLimits(text) {
  const selected = {};
  const wanted = [
    "Max cpu time",
    "Max file size",
    "Max processes",
    "Max open files",
    "Max address space",
  ];
  for (const line of text.split("\n")) {
    const prefix = wanted.find((name) => line.startsWith(name));
    if (prefix === undefined) {
      continue;
    }
    // Format: "<Name (may contain spaces)>  <soft>  <hard>  <units>"
    const fields = line.slice(prefix.length).trim().split(/\s+/u);
    const soft = fields[0] ?? null;
    const hard = fields[1] ?? null;
    if (soft !== null && hard !== null) {
      selected[prefix] = { soft, hard };
    }
  }
  return selected;
}

const cgroup = {
  memory_max: boundedRead("/sys/fs/cgroup/memory.max", 64),
  memory_swap_max: boundedRead("/sys/fs/cgroup/memory.swap.max", 64),
  pids_max: boundedRead("/sys/fs/cgroup/pids.max", 64),
  cpu_max: boundedRead("/sys/fs/cgroup/cpu.max", 128),
  cgroup_controllers: boundedRead("/sys/fs/cgroup/cgroup.controllers", 256),
};

const limitsText = boundedRead("/proc/self/limits", 8192);
const rlimits =
  limitsText.state === "observed" ? parseLimits(limitsText.text) : { state: limitsText.state };

process.stdout.write(
  `${JSON.stringify({
    schema_version: "runparity.backend-probe/limits/v1",
    cgroup,
    rlimits,
  })}\n`,
);
