import { randomUUID } from "node:crypto";
import { Command, CommanderError } from "commander";
import { CommandResolutionError, type LaunchKind } from "./command-resolution.js";
import { type CompiledContract, compileContract } from "./contract.js";
import { type ControllerRuntime, describeControllerRuntime } from "./controller-runtime.js";
import {
  diagnoseNativeAbiMismatch,
  diagnosePackageManagerDrift,
  diagnosePathShadowing,
  diagnoseRuntimeDrift,
  type Finding,
  type ObservedPackageManager,
  type ObservedRuntime,
  rankFindings,
} from "./diagnosis.js";
import { captureRunSpec, observeHost } from "./host-observe.js";
import { renderHtmlReport } from "./html-report.js";
import type { NpmConfigSourceConflict } from "./npm-config.js";
import { pathsDifferForDisplay } from "./path-display.js";
import type { CapturedStream, ProcessCleanup } from "./process-observer.js";
import { applyProofRefusal, decideProofRefusal } from "./proof-refusal.js";
import { createRedactionContext, type RedactionContext, redactText } from "./redaction.js";
import {
  classifyHostOutcome,
  decideHostOutcome,
  type HostReportStatus,
  type HostResultStatus,
  type HostVerdict,
  type HostWarningCode,
} from "./verdict.js";

const CLI_VERSION = "0.0.0";

type CliEnvelope = {
  schema: "runparity.cli/v1";
  ok: true;
  command: "doctor";
  data: {
    report: {
      schema: "runparity.report/v1";
      status: HostReportStatus;
      exit_policy: "preserve_target" | "report_only";
      verdict: HostVerdict;
      controller_runtime: Omit<ControllerRuntime, "warning">;
      execution_context: "HOST_OBSERVATION";
      experiment_progress: "OBSERVED";
      contract: CompiledContract;
      observation: {
        requested_argv: string[];
        runtime: ObservedRuntime | null;
        package_manager: ObservedPackageManager | null;
        config_source_conflicts: NpmConfigSourceConflict[];
        launch: {
          requested_program: string;
          selected_search_path: string;
          resolved_path: string;
          kind: LaunchKind;
          executable_path: string;
          argv0: string;
          script_path: string | null;
          candidates: string[];
          candidate_resolutions: Array<{
            search_path: string;
            canonical_path: string;
          }>;
          candidate_resolutions_truncated: boolean;
        };
        result: {
          status: HostResultStatus;
          started: boolean;
          duration_ms: number;
          exit_code: number | null;
          signal: NodeJS.Signals | null;
          timed_out: boolean;
          timeout_phase: "before_launch" | "execution" | null;
          stdout: CapturedStream;
          stderr: CapturedStream;
          cleanup: ProcessCleanup;
          stream_capture: {
            status: "complete" | "incomplete";
            reason_code: "RP_STREAM_DRAIN_INCOMPLETE" | null;
          };
        };
      };
      reference: {
        resolution: "not_found";
        qualification: "not_applicable";
        compatibility: "unknown";
        reason_codes: ["RP_REFERENCE_NOT_FOUND"];
      };
      findings: Finding[];
      experiment: {
        status: "not_attempted";
        reason_codes: string[];
      };
      remediation: {
        mode: "manual_only";
        changes: [];
      };
    };
  };
  error: null;
  warnings: Array<{ code: string; message: string }>;
  meta: {
    cli_version: string;
    invocation_id: string;
  };
};

type CliErrorEnvelope = {
  schema: "runparity.cli/v1";
  ok: false;
  command: "doctor";
  data: null;
  error: {
    code: string;
    message: string;
    retryable: false;
    details: null;
  };
  warnings: [];
  meta: {
    cli_version: string;
    invocation_id: string;
  };
};

class CliInputError extends Error {
  readonly code = "RP_INVALID_TIMEOUT";
}

class CliUsageError extends Error {
  readonly code = "RP_USAGE_ERROR";
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(ms|s|m)?$/i);
  if (match?.[1] === undefined) {
    throw new CliInputError("Timeout must be a positive duration such as 500ms, 30s, or 5m.");
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2]?.toLowerCase() ?? "ms";
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 24 * 60 * 60 * 1_000) {
    throw new CliInputError("Timeout must be between 1ms and 24h.");
  }
  return duration;
}

function redactContractEvidence(
  contract: CompiledContract,
  redaction: RedactionContext,
): CompiledContract {
  return {
    ...contract,
    constraints: contract.constraints.map((constraint) => ({
      ...constraint,
      name: redaction.redactScalar(constraint.name),
      selector: redaction.redactScalar(constraint.selector),
      provenance: {
        ...constraint.provenance,
        file: redaction.redactScalar(constraint.provenance.file),
        pointer: redaction.redactScalar(constraint.provenance.pointer),
      },
    })),
    unresolved: contract.unresolved.map((unresolved) => ({
      ...unresolved,
      file: redaction.redactScalar(unresolved.file),
      pointer: redaction.redactScalar(unresolved.pointer),
    })),
  };
}

function redactPackageManagerEvidence(
  manager: ObservedPackageManager | null,
  redaction: RedactionContext,
): ObservedPackageManager | null {
  if (manager === null) return null;
  return {
    ...manager,
    version: redaction.redactScalar(manager.version),
    manifest_path: redaction.redactScalar(manager.manifest_path),
  };
}

function redactConfigEvidence(
  observations: readonly NpmConfigSourceConflict[],
  redaction: RedactionContext,
): NpmConfigSourceConflict[] {
  return observations.map((observation) => ({
    ...observation,
    sources: observation.sources.map((source) => ({
      ...source,
      provenance: {
        ...source.provenance,
        environment_variable:
          source.provenance.environment_variable === null
            ? null
            : redaction.redactScalar(source.provenance.environment_variable),
      },
    })),
  }));
}

function redactFindingEvidence(finding: Finding, redaction: RedactionContext): Finding {
  if (finding.id === "RP-RUNTIME-0001") {
    return {
      ...finding,
      observed: redaction.redactScalar(finding.observed),
      expected: redaction.redactScalar(finding.expected),
      intervention: {
        ...finding.intervention,
        selector: redaction.redactScalar(finding.intervention.selector),
      },
    };
  }
  if (finding.id === "RP-RUNTIME-0002") {
    return {
      ...finding,
      observed: {
        name: redaction.redactScalar(finding.observed.name),
        version: redaction.redactScalar(finding.observed.version),
      },
      expected: {
        name: redaction.redactScalar(finding.expected.name),
        version: redaction.redactScalar(finding.expected.version),
      },
      intervention: {
        ...finding.intervention,
        selector: redaction.redactScalar(finding.intervention.selector),
      },
    };
  }
  if (finding.id === "RP-PATH-0001") {
    return {
      ...finding,
      selected: redaction.redactScalar(finding.selected),
      alternatives: finding.alternatives.map(redaction.redactScalar),
    };
  }
  return finding;
}

function redactEnvelopeEvidence(envelope: CliEnvelope, redaction: RedactionContext): CliEnvelope {
  const report = envelope.data.report;
  const launch = report.observation.launch;
  const sanitized: CliEnvelope = {
    ...envelope,
    data: {
      report: {
        ...report,
        contract: redactContractEvidence(report.contract, redaction),
        observation: {
          ...report.observation,
          package_manager: redactPackageManagerEvidence(
            report.observation.package_manager,
            redaction,
          ),
          config_source_conflicts: redactConfigEvidence(
            report.observation.config_source_conflicts,
            redaction,
          ),
          launch: {
            ...launch,
            requested_program: redaction.redactScalar(launch.requested_program),
            selected_search_path: redaction.redactScalar(launch.selected_search_path),
            resolved_path: redaction.redactScalar(launch.resolved_path),
            executable_path: redaction.redactScalar(launch.executable_path),
            argv0: redaction.redactScalar(launch.argv0),
            script_path:
              launch.script_path === null ? null : redaction.redactScalar(launch.script_path),
            candidates: launch.candidates.map(redaction.redactScalar),
            candidate_resolutions: launch.candidate_resolutions.map((candidate) => ({
              search_path: redaction.redactScalar(candidate.search_path),
              canonical_path: redaction.redactScalar(candidate.canonical_path),
            })),
            candidate_resolutions_truncated: launch.candidate_resolutions_truncated,
          },
        },
        findings: report.findings.map((finding) => redactFindingEvidence(finding, redaction)),
      },
    },
  };
  return redaction.sanitizeStructuredDisplay(sanitized);
}

function hostOutcomeWarning(
  code: HostWarningCode,
  timeoutMs: number,
): { code: string; message: string } {
  switch (code) {
    case "RP_OBSERVATION_DEADLINE_EXPIRED":
      return {
        code,
        message: "The observation deadline expired before the target process was started.",
      };
    case "RP_TARGET_TIMEOUT":
      return { code, message: `The target exceeded the ${timeoutMs}ms observation timeout.` };
    case "RP_PROCESS_TREE_CLEANUP_FAILED":
      return {
        code,
        message: "RunParity could not complete its best-effort host process-tree cleanup.",
      };
    case "RP_PROCESS_TREE_NOT_CONTAINED":
      return {
        code,
        message: "Host cleanup is best effort; already detached descendants cannot be verified.",
      };
    case "RP_FAILURE_NOT_OBSERVED":
      return {
        code,
        message:
          "The requested command completed successfully, so there is no reproduced failure to diagnose.",
      };
    case "RP_REFERENCE_NOT_FOUND":
      return {
        code: "RP_REFERENCE_NOT_FOUND",
        message: "No qualified reference was available; no reference comparison was performed.",
      };
  }
}

async function observe(
  argv: string[],
  timeoutMs: number,
  exitPolicy: "preserve_target" | "report_only",
  redaction: RedactionContext,
): Promise<CliEnvelope> {
  const cwd = process.cwd();
  const spec = captureRunSpec({
    argv,
    cwd,
    workspaceRoot: cwd,
    environment: process.env,
    timeoutMs,
  });
  const contract = compileContract(cwd);
  const controllerRuntime = describeControllerRuntime(process.versions.node);
  const observed = await observeHost(spec);
  const {
    request,
    launch,
    runtime,
    packageManager,
    configSourceConflicts,
    process: result,
  } = observed;
  const exitCode = result.exitCode;
  const outcome = decideHostOutcome(classifyHostOutcome(result));
  const passed = outcome.resultStatus === "passed";
  const timedOut = result.timedOut;
  const findings =
    !passed && !timedOut
      ? rankFindings([
          ...diagnoseNativeAbiMismatch(
            `${result.stderr.redacted_excerpt}\n${result.stdout.redacted_excerpt}`,
          ),
          ...diagnoseRuntimeDrift(contract, runtime),
          ...diagnosePackageManagerDrift(contract, packageManager),
          ...diagnosePathShadowing(launch),
        ])
      : [];

  const envelope: CliEnvelope = {
    schema: "runparity.cli/v1",
    ok: true,
    command: "doctor",
    data: {
      report: {
        schema: "runparity.report/v1",
        status: outcome.reportStatus,
        exit_policy: exitPolicy,
        verdict: outcome.verdict,
        controller_runtime: {
          name: controllerRuntime.name,
          version: controllerRuntime.version,
          support_status: controllerRuntime.support_status,
        },
        execution_context: "HOST_OBSERVATION",
        experiment_progress: "OBSERVED",
        contract,
        observation: {
          requested_argv: request.argv,
          runtime,
          package_manager: packageManager,
          config_source_conflicts: configSourceConflicts,
          launch: {
            requested_program: launch.requestedProgram,
            selected_search_path: launch.selectedSearchPath,
            resolved_path: launch.resolvedPath,
            kind: launch.kind,
            executable_path: launch.executablePath,
            argv0: launch.argv0,
            script_path: launch.scriptPath,
            candidates: launch.candidates,
            candidate_resolutions: launch.candidateResolutions.map((candidate) => ({
              search_path: candidate.searchPath,
              canonical_path: candidate.canonicalPath,
            })),
            candidate_resolutions_truncated: launch.candidateResolutionsTruncated,
          },
          result: {
            status: outcome.resultStatus,
            started: result.started,
            duration_ms: result.durationMs,
            exit_code: exitCode,
            signal: result.signal,
            timed_out: timedOut,
            timeout_phase: result.timeoutPhase,
            stdout: result.stdout,
            stderr: result.stderr,
            cleanup: result.cleanup,
            stream_capture: {
              status: result.streamCapture.status,
              reason_code: result.streamCapture.reasonCode,
            },
          },
        },
        reference: {
          resolution: "not_found",
          qualification: "not_applicable",
          compatibility: "unknown",
          reason_codes: ["RP_REFERENCE_NOT_FOUND"],
        },
        findings,
        experiment: {
          status: "not_attempted",
          reason_codes: [outcome.experimentReasonCode],
        },
        remediation: {
          mode: "manual_only",
          changes: [],
        },
      },
    },
    error: null,
    warnings: [
      ...(controllerRuntime.warning === null ? [] : [controllerRuntime.warning]),
      ...outcome.warningCodes.map((code) => hostOutcomeWarning(code, timeoutMs)),
      ...(result.streamCapture.status === "incomplete"
        ? [
            {
              code: "RP_STREAM_DRAIN_INCOMPLETE",
              message:
                "Output capture stopped after the post-process drain grace; the recorded stream tail may be incomplete.",
            },
          ]
        : []),
    ],
    meta: {
      cli_version: CLI_VERSION,
      invocation_id: `rpi_${randomUUID()}`,
    },
  };
  return redactEnvelopeEvidence(envelope, redaction);
}

function renderFinding(finding: Finding): string[] {
  if (finding.id === "RP-RUNTIME-0001") {
    return [
      `  Candidate  Node ${finding.observed} is outside the declared range ${finding.expected}`,
      "             This drift is observed; it has not been verified as the cause.",
    ];
  }
  if (finding.id === "RP-RUNTIME-0002") {
    return [
      `  Candidate  Invoked ${finding.observed.name}@${finding.observed.version}; contract declares ${finding.expected.name}@${finding.expected.version}`,
      "             This drift is observed; it has not been verified as the cause.",
    ];
  }
  if (finding.category === "NATIVE_ABI_ARCH_MISMATCH") {
    return [
      `  Supported  Native module ABI ${finding.observed_module_abi} differs from runtime ABI ${finding.required_runtime_abi}`,
      "             The failing artifact is not yet identified; no rebuild was attempted.",
    ];
  }
  return [
    `  Candidate  PATH selected ${finding.selected}`,
    `             ${finding.alternatives.length} other executable candidate(s) were shadowed.`,
    "             Selection is observed; causation has not been verified.",
  ];
}

function renderHuman(envelope: CliEnvelope): string {
  const { report } = envelope.data;
  const result = report.observation.result;
  const heading =
    result.status === "deadline_expired_before_launch"
      ? "TIMEOUT  Observation deadline expired before target launch"
      : result.status === "timed_out" && result.cleanup.status !== "verified"
        ? "SAFETY ABORT  Timed-out host command was not contained"
        : result.status === "passed"
          ? "PASS  Command completed (exit 0)"
          : result.status === "timed_out"
            ? "TIMEOUT  Command exceeded the observation limit"
            : result.exit_code === null
              ? `STOP  Command terminated (${result.signal ?? "unknown signal"})`
              : `FAIL  Command failed (exit ${result.exit_code})`;
  const command = report.observation.requested_argv
    .map((argument) => (/^[\w./:\\-]+$/.test(argument) ? argument : JSON.stringify(argument)))
    .join(" ");
  const findingLines =
    report.findings.length === 0
      ? ["  No supported hypothesis yet."]
      : report.findings.flatMap(renderFinding);
  const errorExcerpt =
    result.stderr.redacted_excerpt.trim().length > 0
      ? result.stderr.redacted_excerpt.trimEnd()
      : result.stdout.redacted_excerpt.trimEnd();
  const errorLines =
    errorExcerpt.length === 0
      ? ["  No target output was captured."]
      : errorExcerpt.split("\n").map((line) => `  ${line}`);
  const launch = report.observation.launch;
  const launchLines = pathsDifferForDisplay(launch.selected_search_path, launch.resolved_path)
    ? [
        `Matched path      ${launch.selected_search_path}`,
        `Canonical target  ${launch.resolved_path}`,
      ]
    : [`Resolved   ${launch.resolved_path}`];

  return [
    "RunParity",
    "=========",
    heading,
    "",
    `Command    ${command}`,
    ...launchLines,
    `Duration   ${result.duration_ms.toFixed(0)} ms`,
    `Context    ${report.execution_context}`,
    `Verdict    ${report.verdict}`,
    "",
    "What we found",
    ...findingLines,
    "",
    "Last target output",
    ...errorLines,
    "",
    "Safety",
    result.started
      ? "  RunParity applied no remediation. The requested command ran on the host and may have its own side effects."
      : "  RunParity applied no remediation and did not start the requested command.",
  ].join("\n");
}

function errorEnvelope(
  error: unknown,
  redact: (value: string) => string = redactText,
): {
  envelope: CliErrorEnvelope;
  exitCode: number;
} {
  const isResolutionError = error instanceof CommandResolutionError;
  const code = isResolutionError
    ? error.code
    : error instanceof CommanderError
      ? "RP_USAGE_ERROR"
      : error instanceof CliInputError
        ? error.code
        : error instanceof CliUsageError
          ? error.code
          : "RP_INTERNAL_ERROR";
  const message = redact(error instanceof Error ? error.message : "Unexpected internal error.");
  const exitCode =
    code === "RP_UNVERIFIED_WINDOWS_SHIM"
      ? 77
      : code === "RP_COMMAND_NOT_EXECUTABLE"
        ? 126
        : code === "RP_COMMAND_NOT_FOUND"
          ? 69
          : code === "RP_INVALID_TIMEOUT" || code === "RP_USAGE_ERROR"
            ? 64
            : 70;

  return {
    envelope: {
      schema: "runparity.cli/v1",
      ok: false,
      command: "doctor",
      data: null,
      error: {
        code,
        message,
        retryable: false,
        details: null,
      },
      warnings: [],
      meta: {
        cli_version: CLI_VERSION,
        invocation_id: `rpi_${randomUUID()}`,
      },
    },
    exitCode,
  };
}

const program = new Command()
  .name("runparity")
  .description("Evidence-first diagnosis for environment-dependent JavaScript failures.")
  .version(CLI_VERSION)
  .option("--json", "emit one stable JSON document to stdout")
  .option("--html", "render one completed observation as an offline HTML document");

program.addHelpText(
  "after",

  "\nNew here? One command covers the common case:\n" +
    "  runparity doctor -- npm run build\n" +
    "RunParity records what actually ran (which binary, which runtime, which\n" +
    "config won) and says how strong the evidence is. It never guesses a root\n" +
    "cause and never repairs anything.\n",
);

const doctorCommand = program
  .command("doctor")
  .description("observe a command and report only what the available evidence supports")
  .option("--timeout <duration>", "stop observation after this duration", "5m")
  .option("--report-only", "return zero when RunParity produced a valid report")
  .option(
    "--attempt-proof",
    "request an isolated proof attempt; hosts without a qualified native backend refuse with REFUSED_OUT_OF_SCOPE",
  )
  .argument("<argv...>", "target executable and arguments; place them after --")
  .action(async (argv: string[]) => {
    const redaction = createRedactionContext(argv);
    try {
      const separatedTargetArguments =
        targetSeparatorIndex === -1 ? [] : rawCliArguments.slice(targetSeparatorIndex + 1);
      const targetMatchesSeparator =
        separatedTargetArguments.length === argv.length &&
        separatedTargetArguments.every((argument, index) => argument === argv[index]);
      if (
        targetSeparatorIndex === -1 ||
        separatedTargetArguments.length === 0 ||
        !targetMatchesSeparator
      ) {
        throw new CliUsageError("The target command and every target argument must follow --.");
      }
      const outputOptions = program.opts<{ html?: boolean; json?: boolean }>();
      if (outputOptions.json && outputOptions.html) {
        throw new CliUsageError("Choose only one report output mode: --json or --html.");
      }
      const options = doctorCommand.opts<{
        reportOnly?: boolean;
        timeout: string;
        attemptProof?: boolean;
      }>();
      const timeoutMs = parseDuration(options.timeout);
      const exitPolicy = options.reportOnly ? "report_only" : "preserve_target";
      let envelope = await observe(argv, timeoutMs, exitPolicy, redaction);
      let proofRefused = false;
      if (options.attemptProof === true) {
        const decision = decideProofRefusal(process.platform, envelope.data.report.verdict);
        envelope = applyProofRefusal(envelope, decision);
        proofRefused = decision.refused;
      }
      const output = outputOptions.json
        ? JSON.stringify(envelope)
        : outputOptions.html
          ? renderHtmlReport(envelope)
          : renderHuman(envelope);
      process.stdout.write(`${output}\n`);
      process.exitCode = proofRefused
        ? 78
        : envelope.data.report.verdict === "ABORTED_SAFETY"
          ? 74
          : envelope.data.report.observation.result.timed_out
            ? 124
            : options.reportOnly
              ? 0
              : (envelope.data.report.observation.result.exit_code ?? 1);
    } catch (error) {
      const failure = errorEnvelope(error, redaction.redactScalar);
      if (program.opts<{ json?: boolean }>().json) {
        process.stdout.write(`${JSON.stringify(failure.envelope)}\n`);
      } else {
        process.stderr.write(`RunParity: ${failure.envelope.error.message}\n`);
      }
      process.exitCode = failure.exitCode;
    }
  });

const rawCliArguments = process.argv.slice(2);
const targetSeparatorIndex = rawCliArguments.indexOf("--");
const controlArguments =
  targetSeparatorIndex === -1 ? rawCliArguments : rawCliArguments.slice(0, targetSeparatorIndex);
const jsonRequested = controlArguments.includes("--json");
const bootstrapRedaction = createRedactionContext(rawCliArguments);
bootstrapRedaction.learnSensitiveEnvironment(process.env);
program.configureOutput({
  outputError: () => undefined,
});
program.exitOverride();
doctorCommand.configureOutput({
  outputError: () => undefined,
});
doctorCommand.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  if (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version")
  ) {
    process.exitCode = 0;
  } else {
    const failure = errorEnvelope(error, bootstrapRedaction.redactScalar);
    if (jsonRequested) {
      process.stdout.write(`${JSON.stringify(failure.envelope)}\n`);
    } else {
      process.stderr.write(`RunParity: ${failure.envelope.error.message}\n`);
    }
    process.exitCode = failure.exitCode;
  }
}
