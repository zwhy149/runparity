// RunParity backend qualification probe: spawn a detached child that must be
// destroyed together with the arm container's PID namespace. The qualification
// collector observes, from the backend VM host, that no such child survives
// after the container is removed.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const child = spawn("sleep", ["600"], {
  detached: true,
  stdio: "ignore",
  env: {},
});
child.unref();

const pid = typeof child.pid === "number" ? child.pid : null;
writeFileSync("/home/arm/detached-child.pid", `${pid ?? "unknown"}\n`, { flag: "wx" });

process.stdout.write(
  `${JSON.stringify({
    schema_version: "runparity.backend-probe/detached-spawner/v1",
    spawned: pid !== null,
    child_pid: pid,
  })}\n`,
);
