import type { LaunchPlan } from "./command-resolution.js";
import { createRedactionContext, type RedactionContext } from "./redaction.js";
import {
  type ProcessCleanup,
  type ProcessController,
  type RawCapturedStream,
  runSupervisedProcess,
  type SupervisedProcessHooks,
} from "./supervised-process.js";

export type { ProcessCleanup, ProcessController } from "./supervised-process.js";
export { currentProcessController } from "./supervised-process.js";

export type CapturedStream = {
  redacted_excerpt: string;
  bytes: number;
  digest: {
    algorithm: "HMAC-SHA-256";
    key_scope: "invocation";
    value: string;
  };
  truncated: boolean;
};

export type ObservedProcessResult = {
  started: boolean;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  timeoutPhase: "before_launch" | "execution" | null;
  stdout: CapturedStream;
  stderr: CapturedStream;
  cleanup: ProcessCleanup;
  streamCapture: {
    status: "complete" | "incomplete";
    reasonCode: "RP_STREAM_DRAIN_INCOMPLETE" | null;
  };
};

export type ProcessObservationSpec = {
  launch: LaunchPlan;
  cwd: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  deadlineNanoseconds: bigint;
  controller: ProcessController;
};

function projectStream(stream: RawCapturedStream, redaction: RedactionContext): CapturedStream {
  try {
    return {
      redacted_excerpt: redaction.redactExcerpt(stream.tail, stream.truncated, 64 * 1024),
      bytes: stream.bytes,
      digest: stream.digest,
      truncated: stream.truncated,
    };
  } finally {
    stream.tail.fill(0);
  }
}

export async function observeProcess(
  spec: ProcessObservationSpec,
  redaction: RedactionContext = createRedactionContext([]),
  hooks: SupervisedProcessHooks = {},
): Promise<ObservedProcessResult> {
  const result = await runSupervisedProcess(spec, hooks);
  try {
    return {
      started: result.started,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      timeoutPhase: result.timeoutPhase,
      stdout: projectStream(result.stdout, redaction),
      stderr: projectStream(result.stderr, redaction),
      cleanup: result.cleanup,
      streamCapture: result.streamCapture,
    };
  } finally {
    result.stdout.tail.fill(0);
    result.stderr.tail.fill(0);
  }
}
