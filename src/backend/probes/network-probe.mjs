// RunParity backend qualification probe: network egress denial facts.
// Attempts one TCP connection to a fixed IP; the policy decides whether the
// observed failure mode demonstrates unavailable egress.
import { connect } from "node:net";

const TARGETS = [
  { label: "fixed_ipv4_http", host: "93.184.216.34", port: 80, family: 4 },
  { label: "fixed_ipv4_alt", host: "198.51.100.7", port: 443, family: 4 },
];
const CONNECT_TIMEOUT_MS = 3000;

const results = [];
let pending = TARGETS.length;
for (const target of TARGETS) {
  const started = process.hrtime.bigint();
  const socket = connect({ host: target.host, port: target.port, family: target.family });
  const finish = (outcome, code) => {
    socket.destroy();
    results.push({
      target: target.label,
      outcome,
      error_code: code,
      elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6,
    });
    pending -= 1;
    if (pending === 0) {
      process.stdout.write(
        `${JSON.stringify({
          schema_version: "runparity.backend-probe/network/v1",
          results,
        })}\n`,
      );
    }
  };
  socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish("timeout", "ETIMEDOUT"));
  socket.on("error", (error) =>
    finish("refused", typeof error.code === "string" ? error.code : "UNKNOWN"),
  );
  socket.on("connect", () => finish("connected", null));
}
