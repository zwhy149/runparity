import { describe, expect, test } from "vitest";
import { type HtmlReportEnvelope, renderHtmlReport } from "../src/html-report.js";

const hostileText = '<img src=x onerror="alert(1)">';

const envelope: HtmlReportEnvelope = {
  schema: "runparity.cli/v1",
  ok: true,
  command: "doctor",
  data: {
    report: {
      schema: "runparity.report/v1",
      status: "failure_observed",
      verdict: "PARTIAL_EVIDENCE",
      execution_context: "HOST_OBSERVATION",
      experiment_progress: "OBSERVED",
      controller_runtime: {
        name: "node",
        version: "24.15.0",
        support_status: "supported_lts",
      },
      observation: {
        requested_argv: ["node", "fixture.mjs", hostileText],
        launch: {
          selected_search_path: `C:\\tools\\${hostileText}.exe`,
          resolved_path: `C:\\tools\\${hostileText}.exe`,
        },
        result: {
          status: "failed",
          started: true,
          duration_ms: 182.734,
          exit_code: 23,
          signal: null,
          timed_out: false,
          timeout_phase: null,
          stdout: {
            redacted_excerpt: `before ${hostileText}\nafter\n`,
            bytes: 42,
            truncated: false,
          },
          stderr: {
            redacted_excerpt: "RP_FIXTURE_FAILURE\n",
            bytes: 19,
            truncated: false,
          },
          cleanup: {
            attempted: false,
            status: "not_required",
            containment: "uncontained_host",
            strategy: null,
            reason_code: null,
          },
          stream_capture: {
            status: "complete",
            reason_code: null,
          },
        },
      },
      reference: {
        resolution: "not_found",
        qualification: "not_applicable",
        compatibility: "unknown",
        reason_codes: ["RP_REFERENCE_NOT_FOUND"],
      },
      findings: [
        {
          id: "RP-PATH-0001",
          category: "PATH_SHADOWING",
          selected: hostileText,
          alternatives: ["C:\\approved\\tool.exe"],
        },
      ],
      experiment: {
        status: "not_attempted",
        reason_codes: ["RP_PROOF_NOT_REQUESTED"],
      },
      remediation: {
        mode: "manual_only",
        changes: [],
      },
    },
  },
  warnings: [
    {
      code: "RP_REFERENCE_NOT_FOUND",
      message: "No qualified reference was available.",
    },
  ],
  meta: {
    cli_version: "0.0.0",
    invocation_id: "rpi_fixture",
  },
};

function withEmptyFindings(
  reportStatus: HtmlReportEnvelope["data"]["report"]["status"],
  result: Partial<HtmlReportEnvelope["data"]["report"]["observation"]["result"]>,
): HtmlReportEnvelope {
  return {
    ...envelope,
    data: {
      report: {
        ...envelope.data.report,
        status: reportStatus,
        verdict:
          reportStatus === "execution_timed_out"
            ? "ABORTED_SAFETY"
            : reportStatus === "failure_observed"
              ? "PARTIAL_EVIDENCE"
              : "INCONCLUSIVE",
        findings: [],
        observation: {
          ...envelope.data.report.observation,
          result: {
            ...envelope.data.report.observation.result,
            ...result,
          },
        },
      },
    },
  };
}

describe("self-contained HTML report", () => {
  test("renders an offline evidence case file and escapes every dynamic field", () => {
    const html = renderHtmlReport(envelope);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("default-src &#39;none&#39;");
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toContain(hostileText);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Observed failure");
    expect(html).toContain("Partial evidence");
    expect(html).toContain("Observation");
    expect(html).toContain("Reference unavailable");
    expect(html).toContain("Experiment not attempted");
    expect(html).toContain('<ol class="evidence-rail" role="list"');
    expect(html).toContain('<ul role="list">');
    expect(html).toContain("@media (max-width: 760px)");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("@media print");
  });

  test("distinguishes a matched alias from the canonical launch target", () => {
    const report = envelope.data.report;
    const html = renderHtmlReport({
      ...envelope,
      data: {
        report: {
          ...report,
          observation: {
            ...report.observation,
            launch: {
              selected_search_path: "C:\\tools\\alias\\probe.exe",
              resolved_path: "C:\\tools\\target\\probe.exe",
            },
          },
        },
      },
    });

    expect(html).toContain("Matched path:");
    expect(html).toContain("C:\\tools\\alias\\probe.exe");
    expect(html).toContain("Canonical target:");
    expect(html).toContain("C:\\tools\\target\\probe.exe");
  });

  test("does not describe a successful target as a reproduced failure", () => {
    const html = renderHtmlReport(
      withEmptyFindings("success_observed", {
        status: "passed",
        started: true,
        exit_code: 0,
      }),
    );

    expect(html).toContain("Failure not reproduced");
    expect(html).toContain("completed successfully");
    expect(html).not.toContain("The failure was reproduced");
  });

  test("does not claim execution or failure reproduction before target launch", () => {
    const html = renderHtmlReport(
      withEmptyFindings("observation_deadline_expired", {
        status: "deadline_expired_before_launch",
        started: false,
        duration_ms: 0,
        exit_code: null,
        timed_out: true,
        timeout_phase: "before_launch",
        stdout: { redacted_excerpt: "", bytes: 0, truncated: false },
        stderr: { redacted_excerpt: "", bytes: 0, truncated: false },
      }),
    );

    expect(html).toContain("No target observation");
    expect(html).toContain("No target process started");
    expect(html).not.toContain("The failure was reproduced");
    expect(html).not.toContain("The requested command ran with the caller's host authority");
  });

  test("fails closed instead of rendering contradictory outcome evidence", () => {
    const contradictory = withEmptyFindings("execution_timed_out", {
      status: "passed",
      started: true,
      exit_code: 0,
      timed_out: false,
      timeout_phase: null,
    });

    expect(() => renderHtmlReport(contradictory)).toThrow("RP_INVALID_HTML_REPORT");
  });

  test("fails closed on fabricated pre-launch output or non-failure findings", () => {
    const fabricatedPreLaunch = withEmptyFindings("observation_deadline_expired", {
      status: "deadline_expired_before_launch",
      started: false,
      duration_ms: 123,
      exit_code: null,
      timed_out: true,
      timeout_phase: "before_launch",
      stdout: { redacted_excerpt: "forged", bytes: 6, truncated: false },
      stderr: { redacted_excerpt: "", bytes: 0, truncated: false },
    });
    const successful = withEmptyFindings("success_observed", {
      status: "passed",
      started: true,
      exit_code: 0,
    });
    const fabricatedSuccessFinding = {
      ...successful,
      data: {
        report: {
          ...successful.data.report,
          findings: envelope.data.report.findings,
        },
      },
    };

    expect(() => renderHtmlReport(fabricatedPreLaunch)).toThrow("RP_INVALID_HTML_REPORT");
    expect(() => renderHtmlReport(fabricatedSuccessFinding)).toThrow("RP_INVALID_HTML_REPORT");
  });

  test("fails closed when fixed Host evidence stages contradict the rendered narrative", () => {
    const report = envelope.data.report;
    const contradictions = [
      { ...report, execution_context: "LINUX_ISOLATED_EXPERIMENT" },
      { ...report, reference: { ...report.reference, resolution: "qualified" } },
      { ...report, experiment: { ...report.experiment, status: "completed" } },
      { ...report, experiment_progress: "COMPLETED" },
      { ...report, remediation: { mode: "automatic", changes: ["changed host"] } },
    ] as unknown as HtmlReportEnvelope["data"]["report"][];

    for (const contradictoryReport of contradictions) {
      const contradictory = {
        ...envelope,
        data: { report: contradictoryReport },
      };
      expect(() => renderHtmlReport(contradictory)).toThrow("RP_INVALID_HTML_REPORT");
    }
  });

  test("keeps captured output keyboard-accessible and labels sanitized or truncated streams exactly", () => {
    const report = envelope.data.report;
    const html = renderHtmlReport({
      ...envelope,
      data: {
        report: {
          ...report,
          observation: {
            ...report.observation,
            result: {
              ...report.observation.result,
              stdout: {
                redacted_excerpt: "",
                bytes: 17,
                truncated: true,
              },
            },
          },
        },
      },
    });

    expect(html).toContain('<h3 id="stderr-output-title">stderr</h3>');
    expect(html).toContain('<pre tabindex="0" aria-labelledby="stderr-output-title">');
    expect(html).toContain('<h3 id="stdout-output-title">stdout</h3>');
    expect(html).toContain('<pre tabindex="0" aria-labelledby="stdout-output-title">');
    expect(html).toContain("No displayable stdout remained after sanitization.");
    expect(html).toContain("tail capture was truncated to the 64 KiB budget");
    expect(html).toContain("pre:focus-visible");
    expect(html).toContain(".command-strip code { white-space: pre-wrap; }");
    expect(html).toContain(".surface { break-inside: auto; box-shadow: none; }");
    expect(html).not.toContain(".section, .command-strip, .safety-note { break-inside: avoid; }");
  });
});
