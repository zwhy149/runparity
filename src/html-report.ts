import { pathsDifferForDisplay } from "./path-display.js";
import type { ProcessCleanup } from "./process-observer.js";
import {
  classifyHostOutcome,
  decideHostOutcome,
  type HostReportStatus,
  type HostResultStatus,
  type HostVerdict,
} from "./verdict.js";

type HtmlCapturedStream = Readonly<{
  redacted_excerpt: string;
  bytes: number;
  truncated: boolean;
}>;

type HtmlProcessResult = Readonly<{
  status: HostResultStatus;
  started: boolean;
  duration_ms: number;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  timeout_phase: "before_launch" | "execution" | null;
  stdout: HtmlCapturedStream;
  stderr: HtmlCapturedStream;
  cleanup: Readonly<ProcessCleanup>;
  stream_capture: Readonly<{
    status: string;
    reason_code: string | null;
  }>;
}>;

export type HtmlReportEnvelope = Readonly<{
  schema: "runparity.cli/v1";
  ok: true;
  command: "doctor";
  data: Readonly<{
    report: Readonly<{
      schema: "runparity.report/v1";
      status: HostReportStatus;
      verdict: HostVerdict;
      execution_context: "HOST_OBSERVATION";
      experiment_progress: "OBSERVED";
      controller_runtime: Readonly<{
        name: string;
        version: string;
        support_status: string;
      }>;
      observation: Readonly<{
        requested_argv: readonly string[];
        launch: Readonly<{
          selected_search_path: string;
          resolved_path: string;
        }>;
        result: HtmlProcessResult;
      }>;
      reference: Readonly<{
        resolution: "not_found";
        qualification: "not_applicable";
        compatibility: "unknown";
        reason_codes: readonly ["RP_REFERENCE_NOT_FOUND"];
      }>;
      findings: readonly unknown[];
      experiment: Readonly<{
        status: "not_attempted";
        reason_codes: readonly string[];
      }>;
      remediation: Readonly<{
        mode: "manual_only";
        changes: readonly [];
      }>;
    }>;
  }>;
  warnings: ReadonlyArray<Readonly<{ code: string; message: string }>>;
  meta: Readonly<{
    cli_version: string;
    invocation_id: string;
  }>;
}>;

type FindingView = Readonly<{
  label: string;
  title: string;
  detail: string;
}>;

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function stringListField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function sentenceCase(value: string): string {
  const normalized = value.toLowerCase().split("_").filter(Boolean).join(" ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function commandText(argv: readonly string[]): string {
  return argv
    .map((argument) => (/^[\w./:\\-]+$/u.test(argument) ? argument : JSON.stringify(argument)))
    .join(" ");
}

function findingView(value: unknown): FindingView {
  if (!isRecord(value)) {
    return {
      label: "Observed candidate",
      title: "Unrecognized finding shape",
      detail: "Open the JSON report for the complete machine-readable evidence.",
    };
  }

  const id = stringField(value, "id") ?? "UNVERSIONED_FINDING";
  if (id === "RP-RUNTIME-0001") {
    return {
      label: "Runtime candidate",
      title: `Node ${stringField(value, "observed") ?? "unknown"} is outside ${stringField(value, "expected") ?? "the declared range"}`,
      detail:
        "The mismatch was observed. No isolated run has shown that changing Node controls the outcome.",
    };
  }

  if (id === "RP-RUNTIME-0002") {
    const observed = isRecord(value["observed"]) ? value["observed"] : {};
    const expected = isRecord(value["expected"]) ? value["expected"] : {};
    const observedName = stringField(observed, "name") ?? "manager";
    const observedVersion = stringField(observed, "version") ?? "unknown";
    const expectedName = stringField(expected, "name") ?? "declared manager";
    const expectedVersion = stringField(expected, "version") ?? "unknown";
    return {
      label: "Manager candidate",
      title: `${observedName}@${observedVersion} differs from ${expectedName}@${expectedVersion}`,
      detail:
        "The invoked local manager claim differs from the project contract; publisher identity is not proven.",
    };
  }

  if (stringField(value, "category") === "NATIVE_ABI_ARCH_MISMATCH") {
    return {
      label: "Native ABI signal",
      title: `Module ABI ${stringField(value, "observed_module_abi") ?? "unknown"} differs from runtime ABI ${stringField(value, "required_runtime_abi") ?? "unknown"}`,
      detail:
        "The failing artifact has not been isolated, and RunParity did not rebuild or replace it.",
    };
  }

  if (stringField(value, "category") === "PATH_SHADOWING" || id === "RP-PATH-0001") {
    const alternatives = stringListField(value, "alternatives");
    return {
      label: "PATH candidate",
      title: `Selected ${stringField(value, "selected") ?? "an unresolved executable"}`,
      detail: `${alternatives.length} other executable candidate${alternatives.length === 1 ? " was" : "s were"} shadowed. Selection is observed; causation is not verified.`,
    };
  }

  return {
    label: "Observed candidate",
    title: id,
    detail: "This bounded finding is evidence, not a verified intervention.",
  };
}

function outcomeView(status: string): Readonly<{
  eyebrow: string;
  title: string;
  summary: string;
  tone: "positive" | "warning" | "danger" | "neutral";
}> {
  switch (status) {
    case "success_observed":
      return {
        eyebrow: "Observed outcome",
        title: "Observed success",
        summary:
          "The command completed, so the reported failure was not reproduced in this observation.",
        tone: "positive",
      };
    case "execution_timed_out":
      return {
        eyebrow: "Safety boundary",
        title: "Safety abort",
        summary:
          "The command exceeded its deadline and Host cleanup could not establish containment.",
        tone: "danger",
      };
    case "observation_deadline_expired":
      return {
        eyebrow: "Observation boundary",
        title: "Observation expired",
        summary: "The shared deadline elapsed before the target could be started.",
        tone: "neutral",
      };
    default:
      return {
        eyebrow: "Observed outcome",
        title: "Observed failure",
        summary:
          "The target failed. RunParity recorded bounded evidence, not a verified root cause.",
        tone: "warning",
      };
  }
}

function emptyFindingsView(result: HtmlProcessResult): Readonly<{ label: string; detail: string }> {
  if (!result.started) {
    return {
      label: "No target observation",
      detail:
        "No target process started, so no runtime failure or environment candidate was observed.",
    };
  }
  if (result.status === "passed") {
    return {
      label: "Failure not reproduced",
      detail:
        "The target completed successfully, so this observation did not reproduce the reported failure.",
    };
  }
  if (result.status === "timed_out") {
    return {
      label: "Diagnosis stopped at the safety boundary",
      detail:
        "The target exceeded its deadline; no bounded environment candidate is promoted from an incomplete Host observation.",
    };
  }
  return {
    label: "No supported hypothesis yet",
    detail:
      "The failure was reproduced, but no current bounded rule produced an environment candidate.",
  };
}

function renderFindings(findings: readonly unknown[], result: HtmlProcessResult): string {
  if (findings.length === 0) {
    const empty = emptyFindingsView(result);
    return `
      <div class="empty-state">
        <p class="utility-label">${escapeHtml(empty.label)}</p>
        <p>${escapeHtml(empty.detail)}</p>
      </div>`;
  }
  return findings
    .map((finding) => {
      const view = findingView(finding);
      return `
        <article class="finding">
          <p class="utility-label">${escapeHtml(view.label)}</p>
          <h3>${escapeHtml(view.title)}</h3>
          <p>${escapeHtml(view.detail)}</p>
        </article>`;
    })
    .join("");
}

function streamNote(stream: HtmlCapturedStream): string {
  const parts = [`${stream.bytes.toLocaleString("en-US")} original bytes`];
  if (stream.truncated) parts.push("tail capture was truncated to the 64 KiB budget");
  return parts.join(" · ");
}

function streamDisplay(stream: HtmlCapturedStream, channel: "stdout" | "stderr"): string {
  if (stream.redacted_excerpt !== "") return stream.redacted_excerpt;
  return stream.bytes === 0
    ? `No ${channel} captured.`
    : `No displayable ${channel} remained after sanitization.`;
}

function displayExit(result: HtmlProcessResult): string {
  if (!result.started) return "Not started";
  if (result.exit_code !== null) return String(result.exit_code);
  return result.signal ?? "Terminated";
}

function observationStage(result: HtmlProcessResult): Readonly<{ state: string; note: string }> {
  if (!result.started) {
    return { state: "Target not started", note: "No target process existed to observe." };
  }
  if (result.status === "passed") {
    return { state: "Completed · exit 0", note: "The requested failure did not reproduce." };
  }
  if (result.status === "timed_out") {
    return { state: "Timed out", note: "Host cleanup remains uncontained." };
  }
  return {
    state: result.exit_code === null ? "Terminated" : `Completed · exit ${result.exit_code}`,
    note: "The target failure was reproduced on the host.",
  };
}

function invalidHtmlReport(): never {
  throw new Error("RP_INVALID_HTML_REPORT: contradictory Host Observe outcome evidence.");
}

function assertConsistentHtmlReport(envelope: HtmlReportEnvelope): void {
  const report = envelope.data.report;
  const result = report.observation.result;
  if (
    report.execution_context !== "HOST_OBSERVATION" ||
    report.reference.resolution !== "not_found" ||
    report.reference.qualification !== "not_applicable" ||
    report.reference.compatibility !== "unknown" ||
    report.reference.reason_codes.length !== 1 ||
    report.reference.reason_codes[0] !== "RP_REFERENCE_NOT_FOUND" ||
    report.experiment.status !== "not_attempted" ||
    report.experiment_progress !== "OBSERVED" ||
    report.remediation.mode !== "manual_only" ||
    report.remediation.changes.length !== 0
  ) {
    invalidHtmlReport();
  }
  if (!Number.isFinite(result.duration_ms) || result.duration_ms < 0) {
    invalidHtmlReport();
  }
  if (
    !result.started &&
    (result.duration_ms !== 0 ||
      result.signal !== null ||
      result.stdout.bytes !== 0 ||
      result.stdout.redacted_excerpt !== "" ||
      result.stdout.truncated ||
      result.stderr.bytes !== 0 ||
      result.stderr.redacted_excerpt !== "" ||
      result.stderr.truncated ||
      result.stream_capture.status !== "complete" ||
      result.stream_capture.reason_code !== null)
  ) {
    invalidHtmlReport();
  }
  if (
    result.status !== "failed" &&
    result.status !== "terminated" &&
    report.findings.length !== 0
  ) {
    invalidHtmlReport();
  }
  let decision: ReturnType<typeof decideHostOutcome>;
  try {
    decision = decideHostOutcome(
      classifyHostOutcome({
        started: result.started,
        exitCode: result.exit_code,
        timedOut: result.timed_out,
        timeoutPhase: result.timeout_phase,
        cleanup: result.cleanup,
      }),
    );
  } catch {
    invalidHtmlReport();
  }

  if (
    decision.reportStatus !== report.status ||
    decision.resultStatus !== result.status ||
    decision.verdict !== report.verdict
  ) {
    invalidHtmlReport();
  }
}

export function renderHtmlReport(envelope: HtmlReportEnvelope): string {
  assertConsistentHtmlReport(envelope);
  const report = envelope.data.report;
  const result = report.observation.result;
  const outcome = outcomeView(report.status);
  const observation = observationStage(result);
  const command = commandText(report.observation.requested_argv);
  const launch = report.observation.launch;
  const pathDetails = pathsDifferForDisplay(launch.selected_search_path, launch.resolved_path)
    ? `<p class="path-value">Matched path: ${escapeHtml(launch.selected_search_path)}</p>
        <p class="path-value">Canonical target: ${escapeHtml(launch.resolved_path)}</p>`
    : `<p class="path-value">Resolved: ${escapeHtml(launch.resolved_path)}</p>`;
  const warnings = envelope.warnings
    .map(
      (warning) => `
        <li>
          <code>${escapeHtml(warning.code)}</code>
          <span>${escapeHtml(warning.message)}</span>
        </li>`,
    )
    .join("");
  const warningSection =
    envelope.warnings.length === 0
      ? ""
      : `
        <section class="section warnings" aria-labelledby="warnings-title">
          <div class="section-heading">
            <p class="utility-label">Attention</p>
            <h2 id="warnings-title">Warnings</h2>
          </div>
          <ul role="list">${warnings}</ul>
        </section>`;
  const safetyBoundary = result.started
    ? "<strong>This was Host Observe, not a sandbox.</strong> The requested command ran with the caller's host authority. RunParity applied no remediation. Redaction is defense in depth; review this report before sharing it."
    : "<strong>No target process started in this observation.</strong> The Host Observe request still did not create a sandbox; any target that starts would run with the caller's host authority. RunParity applied no remediation. Redaction is defense in depth; review this report before sharing it.";
  const stdout = streamDisplay(result.stdout, "stdout");
  const stderr = streamDisplay(result.stderr, "stderr");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(CONTENT_SECURITY_POLICY)}">
  <meta name="color-scheme" content="light dark">
  <title>RunParity — ${escapeHtml(outcome.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --paper: #f4f1e8;
      --paper-raised: #fffdf7;
      --ink: #14221d;
      --ink-muted: #59655f;
      --line: #c9c9bc;
      --line-strong: #919a92;
      --accent: #0b6757;
      --accent-soft: #dcebe5;
      --warning: #9b4e12;
      --warning-soft: #f5dfc8;
      --danger: #9d332c;
      --danger-soft: #f5d9d4;
      --positive: #317044;
      --positive-soft: #dbeadf;
      --grid: rgba(20, 34, 29, 0.055);
      --shadow: 0 18px 55px rgba(29, 37, 32, 0.09);
      --radius: 18px;
      --mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --body: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --display: Georgia, "Times New Roman", serif;
    }

    * { box-sizing: border-box; }

    html { min-width: 320px; background: var(--paper); }

    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--body);
      line-height: 1.55;
      background-color: var(--paper);
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 28px 28px;
    }

    .shell {
      width: min(1120px, calc(100% - 40px));
      margin: 0 auto;
      padding: 34px 0 56px;
    }

    .masthead {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: baseline;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line-strong);
    }

    .brand {
      margin: 0;
      font-family: var(--display);
      font-size: clamp(1.35rem, 2vw, 1.75rem);
      font-weight: 700;
      letter-spacing: -0.025em;
    }

    .document-id {
      margin: 0;
      color: var(--ink-muted);
      font-family: var(--mono);
      font-size: 0.72rem;
      overflow-wrap: anywhere;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(250px, 0.7fr);
      gap: clamp(36px, 7vw, 88px);
      align-items: end;
      padding: clamp(48px, 8vw, 92px) 0 44px;
    }

    .utility-label {
      margin: 0 0 8px;
      color: var(--ink-muted);
      font-family: var(--mono);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }

    .hero h1 {
      max-width: 780px;
      margin: 0;
      font-family: var(--display);
      font-size: clamp(3rem, 8vw, 6.9rem);
      font-weight: 500;
      letter-spacing: -0.06em;
      line-height: 0.92;
    }

    .hero-summary {
      max-width: 660px;
      margin: 26px 0 0;
      color: var(--ink-muted);
      font-size: clamp(1rem, 2vw, 1.2rem);
    }

    .verdict-block {
      padding: 20px 0 3px 24px;
      border-left: 5px solid var(--accent);
    }

    .verdict-block.warning { border-color: var(--warning); }
    .verdict-block.danger { border-color: var(--danger); }
    .verdict-block.positive { border-color: var(--positive); }

    .verdict-value {
      margin: 0;
      font-size: clamp(1.4rem, 3vw, 2.2rem);
      font-weight: 750;
      letter-spacing: -0.035em;
      line-height: 1.05;
    }

    .verdict-note {
      margin: 12px 0 0;
      color: var(--ink-muted);
      font-size: 0.92rem;
    }

    .fact-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }

    .fact {
      min-width: 0;
      padding: 22px 22px 22px 0;
    }

    .fact + .fact { padding-left: 22px; border-left: 1px solid var(--line); }

    .fact dt {
      margin-bottom: 8px;
      color: var(--ink-muted);
      font-family: var(--mono);
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .fact dd {
      margin: 0;
      font-size: 0.98rem;
      font-weight: 680;
      overflow-wrap: anywhere;
    }

    .section {
      margin-top: 54px;
    }

    .section-heading {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      align-items: baseline;
      gap: 20px;
      margin-bottom: 22px;
    }

    .section-heading .utility-label { margin: 0; }

    .section h2 {
      margin: 0;
      font-family: var(--display);
      font-size: clamp(1.8rem, 4vw, 3rem);
      font-weight: 500;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    .evidence-rail {
      position: relative;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .evidence-rail::before {
      position: absolute;
      top: 16px;
      right: 12%;
      left: 12%;
      height: 1px;
      background: var(--line-strong);
      content: "";
    }

    .evidence-step {
      position: relative;
      padding: 0 28px 0 0;
    }

    .evidence-step + .evidence-step { padding-left: 28px; }

    .step-index {
      position: relative;
      z-index: 1;
      display: grid;
      width: 33px;
      height: 33px;
      margin-bottom: 18px;
      place-items: center;
      border: 1px solid var(--line-strong);
      border-radius: 50%;
      background: var(--paper);
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 800;
    }

    .evidence-step.active .step-index {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }

    .evidence-step h3 {
      margin: 0 0 8px;
      font-size: 1rem;
    }

    .evidence-step p {
      margin: 0;
      color: var(--ink-muted);
      font-size: 0.9rem;
    }

    .command-strip {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
      margin-top: 54px;
      padding: 23px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }

    .command-strip code,
    .path-value {
      font-family: var(--mono);
      font-size: 0.83rem;
      overflow-wrap: anywhere;
    }

    .command-strip code { white-space: pre-wrap; }

    .command-details { min-width: 0; }
    .command-details p { margin: 0; }
    .command-details .path-value { margin-top: 10px; color: var(--ink-muted); }

    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
      gap: 24px;
      align-items: start;
    }

    .surface {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--paper-raised);
      background: color-mix(in srgb, var(--paper-raised) 94%, transparent);
      box-shadow: var(--shadow);
    }

    .surface-heading {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: baseline;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
    }

    .surface-heading h3 { margin: 0; font-size: 0.95rem; }
    .surface-heading span { color: var(--ink-muted); font-family: var(--mono); font-size: 0.68rem; }

    pre {
      min-height: 140px;
      max-height: 430px;
      margin: 0;
      overflow: auto;
      padding: 22px;
      color: var(--ink);
      font-family: var(--mono);
      font-size: 0.78rem;
      line-height: 1.65;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      word-break: break-word;
    }

    pre:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: -3px;
    }

    .finding {
      padding: 24px 0;
      border-top: 1px solid var(--line);
    }

    .finding:first-child { padding-top: 0; border-top: 0; }
    .finding h3 { max-width: 820px; margin: 0; font-size: clamp(1.15rem, 2.5vw, 1.5rem); line-height: 1.28; overflow-wrap: anywhere; }
    .finding > p:last-child { max-width: 720px; margin: 10px 0 0; color: var(--ink-muted); }

    .empty-state {
      padding: 26px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }

    .empty-state p:last-child { max-width: 680px; margin: 0; color: var(--ink-muted); }

    .warnings ul {
      margin: 0;
      padding: 0;
      list-style: none;
      border-top: 1px solid var(--line);
    }

    .warnings li {
      display: grid;
      grid-template-columns: minmax(150px, 0.28fr) minmax(0, 1fr);
      gap: 20px;
      padding: 16px 0;
      border-bottom: 1px solid var(--line);
    }

    .warnings code { color: var(--warning); font-family: var(--mono); font-size: 0.75rem; overflow-wrap: anywhere; }
    .warnings span { color: var(--ink-muted); }

    .safety-note {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      gap: 20px;
      margin-top: 54px;
      padding: 24px 0;
      border-top: 2px solid var(--ink);
    }

    .safety-note p { max-width: 780px; margin: 0; }
    .safety-note strong { font-weight: 800; }

    footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-top: 64px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
      color: var(--ink-muted);
      font-family: var(--mono);
      font-size: 0.67rem;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #111814;
        --paper-raised: #17201b;
        --ink: #edf1e9;
        --ink-muted: #a8b3aa;
        --line: #344139;
        --line-strong: #667269;
        --accent: #63c6ad;
        --accent-soft: #173e34;
        --warning: #f2aa67;
        --warning-soft: #4b2b18;
        --danger: #f18b80;
        --danger-soft: #49201e;
        --positive: #8bd29a;
        --positive-soft: #1d3e27;
        --grid: rgba(237, 241, 233, 0.045);
        --shadow: 0 18px 55px rgba(0, 0, 0, 0.24);
      }

      .evidence-step.active .step-index { color: #0c2019; }
    }

    @media (max-width: 760px) {
      .shell { width: min(100% - 28px, 1120px); padding-top: 22px; }
      .masthead { align-items: flex-start; flex-direction: column; gap: 8px; }
      .hero { grid-template-columns: 1fr; gap: 34px; padding: 48px 0 34px; }
      .hero h1 { font-size: clamp(3rem, 17vw, 5rem); }
      .verdict-block { max-width: 480px; }
      .fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .fact:nth-child(3) { padding-left: 0; border-top: 1px solid var(--line); border-left: 0; }
      .fact:nth-child(4) { border-top: 1px solid var(--line); }
      .section-heading,
      .command-strip,
      .safety-note { grid-template-columns: 1fr; gap: 8px; }
      .evidence-rail { grid-template-columns: 1fr; gap: 24px; }
      .evidence-rail::before { top: 12px; bottom: 12px; left: 16px; width: 1px; height: auto; }
      .evidence-step,
      .evidence-step + .evidence-step { min-height: 70px; padding: 0 0 0 58px; }
      .step-index { position: absolute; top: 0; left: 0; }
      .content-grid { grid-template-columns: 1fr; }
      .warnings li { grid-template-columns: 1fr; gap: 5px; }
      footer { align-items: flex-start; flex-direction: column; gap: 6px; }
    }

    @media (max-width: 430px) {
      .fact-grid { grid-template-columns: 1fr; }
      .fact,
      .fact + .fact { padding: 16px 0; border-top: 1px solid var(--line); border-left: 0; }
      .fact:first-child { border-top: 0; }
      .surface { border-radius: 12px; }
    }

    @media print {
      :root {
        --paper: #fff;
        --paper-raised: #fff;
        --ink: #000;
        --ink-muted: #3c3c3c;
        --line: #aaa;
        --line-strong: #555;
        --grid: transparent;
        --shadow: none;
      }

      @page { margin: 16mm; }
      .shell { width: 100%; padding: 0; }
      .hero { padding-top: 38px; }
      .content-grid { display: block; }
      .surface { break-inside: auto; box-shadow: none; }
      .surface + .surface { margin-top: 8mm; }
      .surface-heading { break-after: avoid; break-inside: avoid; }
      pre { max-height: none; overflow: visible; }
      .section-heading, .command-strip, .safety-note, .finding, footer { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <p class="brand">RunParity / evidence case file</p>
      <p class="document-id">${escapeHtml(envelope.meta.invocation_id)} · CLI ${escapeHtml(envelope.meta.cli_version)}</p>
    </header>

    <section class="hero" aria-labelledby="report-title">
      <div>
        <p class="utility-label">${escapeHtml(outcome.eyebrow)}</p>
        <h1 id="report-title">${escapeHtml(outcome.title)}</h1>
        <p class="hero-summary">${escapeHtml(outcome.summary)}</p>
      </div>
      <aside class="verdict-block ${outcome.tone}" aria-label="Evidence verdict">
        <p class="utility-label">Causal verdict</p>
        <p class="verdict-value">${escapeHtml(sentenceCase(report.verdict))}</p>
        <p class="verdict-note">Observed evidence stays separate from causal proof.</p>
      </aside>
    </section>

    <dl class="fact-grid" aria-label="Observation summary">
      <div class="fact"><dt>Exit</dt><dd>${escapeHtml(displayExit(result))}</dd></div>
      <div class="fact"><dt>Duration</dt><dd>${escapeHtml(`${result.duration_ms.toFixed(0)} ms`)}</dd></div>
      <div class="fact"><dt>Context</dt><dd>${escapeHtml(sentenceCase(report.execution_context))}</dd></div>
      <div class="fact"><dt>Controller</dt><dd>${escapeHtml(`${report.controller_runtime.name} ${report.controller_runtime.version}`)}</dd></div>
    </dl>

    <section class="section" aria-labelledby="evidence-title">
      <div class="section-heading">
        <p class="utility-label">Evidence strength</p>
        <h2 id="evidence-title">What this run establishes</h2>
      </div>
      <ol class="evidence-rail" role="list" aria-label="Evidence progression">
        <li class="evidence-step active">
          <span class="step-index" aria-hidden="true">01</span>
          <h3>Observation</h3>
          <p><strong>${escapeHtml(observation.state)}</strong><br>${escapeHtml(observation.note)}</p>
        </li>
        <li class="evidence-step">
          <span class="step-index" aria-hidden="true">02</span>
          <h3>Reference unavailable</h3>
          <p>No qualified comparison reference was available for this run.</p>
        </li>
        <li class="evidence-step">
          <span class="step-index" aria-hidden="true">03</span>
          <h3>Experiment not attempted</h3>
          <p>No isolated A1/B/A2 intervention was run, so causation remains unverified.</p>
        </li>
      </ol>
    </section>

    <section class="command-strip" aria-labelledby="command-title">
      <div>
        <p class="utility-label">Requested target</p>
        <h2 id="command-title">Command</h2>
      </div>
      <div class="command-details">
        <p><code>${escapeHtml(command)}</code></p>
        ${pathDetails}
      </div>
    </section>

    <section class="section" aria-labelledby="findings-title">
      <div class="section-heading">
        <p class="utility-label">Bounded diagnosis</p>
        <h2 id="findings-title">What RunParity found</h2>
      </div>
      ${renderFindings(report.findings, result)}
    </section>

    <section class="section" aria-labelledby="output-title">
      <div class="section-heading">
        <p class="utility-label">Captured tail</p>
        <h2 id="output-title">Target output</h2>
      </div>
      <div class="content-grid">
        <article class="surface">
          <div class="surface-heading"><h3 id="stderr-output-title">stderr</h3><span>${escapeHtml(streamNote(result.stderr))}</span></div>
          <pre tabindex="0" aria-labelledby="stderr-output-title">${escapeHtml(stderr)}</pre>
        </article>
        <article class="surface">
          <div class="surface-heading"><h3 id="stdout-output-title">stdout</h3><span>${escapeHtml(streamNote(result.stdout))}</span></div>
          <pre tabindex="0" aria-labelledby="stdout-output-title">${escapeHtml(stdout)}</pre>
        </article>
      </div>
    </section>

    ${warningSection}

    <aside class="safety-note" aria-label="Safety and privacy boundary">
      <p class="utility-label">Safety boundary</p>
      <p>${safetyBoundary}</p>
    </aside>

    <footer>
      <span>${escapeHtml(report.schema)} · ${escapeHtml(report.execution_context)}</span>
      <span>Generated offline · no scripts or external assets</span>
    </footer>
  </main>
</body>
</html>`;
}
