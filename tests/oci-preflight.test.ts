import { describe, expect, test, vi } from "vitest";
import {
  type LinuxRootlessOciPreflightInput,
  type OciPreflightTransport,
  preflightLinuxRootlessOci,
} from "../src/oci/linux-rootless-preflight.js";

const digest = "a".repeat(64);
const imageRef = `registry.example.test/runparity/base@sha256:${digest}`;
const controllerEndpoint =
  process.platform === "win32"
    ? "npipe:////./pipe/dockerDesktopLinuxEngine"
    : "unix:///run/user/1000/docker.sock";
const mismatchedControllerEndpoint =
  process.platform === "win32"
    ? "unix:///run/user/1000/docker.sock"
    : "npipe:////./pipe/dockerDesktopLinuxEngine";

type FixtureResponse = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

function successResponse(command: Parameters<OciPreflightTransport["run"]>[0]): FixtureResponse {
  if (command.args.includes("context")) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        Name: "desktop-linux",
        Endpoints: { docker: { Host: controllerEndpoint } },
      }),
      stderr: "",
    };
  }
  if (command.args.includes("version")) {
    return { exitCode: 0, stdout: JSON.stringify({ Os: "linux", Arch: "amd64" }), stderr: "" };
  }
  if (command.args.includes("info")) {
    return { exitCode: 0, stdout: JSON.stringify(["name=rootless"]), stderr: "" };
  }
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      Id: `sha256:${"b".repeat(64)}`,
      RepoDigests: [imageRef],
      Os: "linux",
      Architecture: "amd64",
    }),
    stderr: "",
  };
}

function successTransport(): OciPreflightTransport {
  return {
    run(command, _abortSignal, complete) {
      complete(successResponse(command));
    },
  };
}

function preflightInput(
  transport: OciPreflightTransport,
  overrides: Partial<LinuxRootlessOciPreflightInput> = {},
): LinuxRootlessOciPreflightInput {
  return {
    approvedContext: "desktop-linux",
    imageRef,
    deadlineNanoseconds: process.hrtime.bigint() + 10_000_000_000n,
    transport,
    ...overrides,
  };
}

describe("linux_rootless_oci preflight", () => {
  test("rootless preflight evidence is still not qualification", async () => {
    const result = await preflightLinuxRootlessOci(preflightInput(successTransport()));

    expect(result).toEqual({
      backend: "linux_rootless_oci",
      status: "unqualified",
      reasonCode: "RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED",
      stage: "live_probes_not_implemented",
    });
    expect(JSON.stringify(result)).not.toContain("receipt");
    expect(Object.keys(result).sort()).toEqual(["backend", "reasonCode", "stage", "status"]);
    expect(result.status).toBe("unqualified");
  });

  test("uses the approved context in ordered, shell-free stage argv with one deadline", async () => {
    const calls: Parameters<OciPreflightTransport["run"]>[0][] = [];
    const inner = successTransport();
    const input = preflightInput({
      run(command, abortSignal, complete) {
        calls.push(command);
        inner.run(command, abortSignal, complete);
      },
    });

    await expect(preflightLinuxRootlessOci(input)).resolves.toMatchObject({
      reasonCode: "RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED",
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["context", "inspect", "desktop-linux", "--format", "{{json .}}"],
      ["--host", controllerEndpoint, "version", "--format", "{{json .Server}}"],
      ["--host", controllerEndpoint, "info", "--format", "{{json .SecurityOptions}}"],
      [
        "--host",
        controllerEndpoint,
        "image",
        "inspect",
        "--platform",
        "linux/amd64",
        imageRef,
        "--format",
        "{{json .}}",
      ],
    ]);
    expect(calls.every((call) => call.deadlineNanoseconds === input.deadlineNanoseconds)).toBe(
      true,
    );
    expect(calls.every((call) => Object.isFrozen(call.args))).toBe(true);
    expect(
      calls.every((call) => Object.keys(call).sort().join(",") === "args,deadlineNanoseconds"),
    ).toBe(true);
  });

  test("snapshots explicit input before an injected stage can mutate the caller object", async () => {
    const calls: string[][] = [];
    const mutableInput = { ...preflightInput(successTransport()) };
    mutableInput.transport = {
      run(command, abortSignal, complete) {
        calls.push([...command.args]);
        mutableInput.approvedContext = "remote-context";
        mutableInput.imageRef = `registry.example.test/runparity/other@sha256:${"d".repeat(64)}`;
        successTransport().run(command, abortSignal, complete);
      },
    };

    await expect(preflightLinuxRootlessOci(mutableInput)).resolves.toMatchObject({
      reasonCode: "RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED",
    });
    expect(calls.flat()).toContain("desktop-linux");
    expect(calls.at(-1)).toContain(imageRef);
  });

  test("refuses a remote Docker endpoint before asking for server facts", async () => {
    const calls: string[][] = [];
    const result = await preflightLinuxRootlessOci(
      preflightInput({
        run(command, _abortSignal, complete) {
          calls.push([...command.args]);
          complete({
            exitCode: 0,
            stdout: JSON.stringify({
              Name: "desktop-linux",
              Endpoints: { docker: { Host: "tcp://engine.example.test:2376" } },
            }),
            stderr: "",
          });
        },
      }),
    );

    expect(result.reasonCode).toBe("RP_SAFETY_GUARD_TRIGGERED");
    expect(calls).toHaveLength(1);
  });

  test("binds the local endpoint family to the actual controller platform", async () => {
    const mismatch = await preflightLinuxRootlessOci(
      preflightInput({
        run(command, abortSignal, complete) {
          if (command.args.includes("context")) {
            complete({
              exitCode: 0,
              stdout: JSON.stringify({
                Name: "desktop-linux",
                Endpoints: { docker: { Host: mismatchedControllerEndpoint } },
              }),
              stderr: "",
            });
            return;
          }
          successTransport().run(command, abortSignal, complete);
        },
      }),
    );

    expect(mismatch).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "context",
    });
  });

  test("treats a missing CLI, null server, and expired budget as unavailable while rejecting an image tag", async () => {
    const missingCli = await preflightLinuxRootlessOci(
      preflightInput({
        run(_command, _abortSignal, complete) {
          complete({ exitCode: 127, stdout: "", stderr: "not found" });
        },
      }),
    );
    const nullServerTransport: OciPreflightTransport = {
      run(command, abortSignal, complete) {
        if (command.args.includes("context")) {
          successTransport().run(command, abortSignal, complete);
          return;
        }
        complete({ exitCode: 0, stdout: "null", stderr: "" });
      },
    };
    const nullServer = await preflightLinuxRootlessOci(preflightInput(nullServerTransport));
    const tag = await preflightLinuxRootlessOci(
      preflightInput(successTransport(), {
        imageRef: "registry.example.test/runparity/base:mutable",
      }),
    );
    const expired = await preflightLinuxRootlessOci(
      preflightInput(successTransport(), { deadlineNanoseconds: process.hrtime.bigint() - 1n }),
    );

    expect([missingCli, nullServer, tag, expired].map((entry) => entry.reasonCode)).toEqual([
      "RP_SANDBOX_UNAVAILABLE",
      "RP_SANDBOX_UNAVAILABLE",
      "RP_SAFETY_GUARD_TRIGGERED",
      "RP_SANDBOX_UNAVAILABLE",
    ]);
  });

  test("refuses a cached image digest mismatch and a fake transport receipt", async () => {
    const mismatchTransport: OciPreflightTransport = {
      run(command, _abortSignal, complete) {
        const response = successResponse(command);
        if (!command.args.includes("image")) {
          complete(response);
          return;
        }
        complete({
          ...response,
          stdout: JSON.stringify({
            Id: `sha256:${"b".repeat(64)}`,
            RepoDigests: [`registry.example.test/runparity/base@sha256:${"c".repeat(64)}`],
            Os: "linux",
            Architecture: "amd64",
          }),
        });
      },
    };
    const receiptTransport: OciPreflightTransport = {
      run(command, _abortSignal, complete) {
        complete({ ...successResponse(command), receipt: { qualified: true } });
      },
    };

    await expect(
      preflightLinuxRootlessOci(preflightInput(mismatchTransport)),
    ).resolves.toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
    });
    await expect(
      preflightLinuxRootlessOci(preflightInput(receiptTransport)),
    ).resolves.toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
    });
  });

  test("refuses a cached image whose OS or architecture does not match linux/amd64", async () => {
    const wrongPlatform: OciPreflightTransport = {
      run(command, _abortSignal, complete) {
        const response = successResponse(command);
        if (!command.args.includes("image")) {
          complete(response);
          return;
        }
        complete({
          ...response,
          stdout: JSON.stringify({
            Id: `sha256:${"b".repeat(64)}`,
            RepoDigests: [imageRef],
            Os: "windows",
            Architecture: "arm64",
          }),
        });
      },
    };

    await expect(preflightLinuxRootlessOci(preflightInput(wrongPlatform))).resolves.toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "image",
    });
  });

  test("requires canonical amd64 identifiers for both server and cached image", async () => {
    const serverAlias: OciPreflightTransport = {
      run(command, _abortSignal, complete) {
        if (command.args.includes("version")) {
          complete({
            exitCode: 0,
            stdout: JSON.stringify({ Os: "linux", Arch: "x86_64" }),
            stderr: "",
          });
          return;
        }
        complete(successResponse(command));
      },
    };
    const imageAlias: OciPreflightTransport = {
      run(command, _abortSignal, complete) {
        const response = successResponse(command);
        if (!command.args.includes("image")) {
          complete(response);
          return;
        }
        complete({
          ...response,
          stdout: JSON.stringify({
            Id: `sha256:${"b".repeat(64)}`,
            RepoDigests: [imageRef],
            Os: "linux",
            Architecture: "x86_64",
          }),
        });
      },
    };

    await expect(preflightLinuxRootlessOci(preflightInput(serverAlias))).resolves.toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "server",
    });
    await expect(preflightLinuxRootlessOci(preflightInput(imageAlias))).resolves.toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "image",
    });
  });

  test("snapshots a delivered response before the transport can mutate it", async () => {
    const result = await preflightLinuxRootlessOci(
      preflightInput({
        run(command, _abortSignal, complete) {
          const response = { ...successResponse(command) };
          complete(response);
          response.exitCode = 91;
          response.stdout = "corrupted after completion";
        },
      }),
    );

    expect(result).toMatchObject({
      reasonCode: "RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED",
      stage: "live_probes_not_implemented",
    });
  });

  test("uses the shared deadline and refuses when it expires between stages", async () => {
    let calls = 0;
    let clock = 0n;
    const clockSpy = vi.spyOn(process.hrtime, "bigint").mockImplementation(() => clock);
    try {
      const result = await preflightLinuxRootlessOci(
        preflightInput(
          {
            run(command, _abortSignal, complete) {
              calls += 1;
              complete(successResponse(command));
              clock = 200n;
            },
          },
          { deadlineNanoseconds: 100n },
        ),
      );

      expect(result.reasonCode).toBe("RP_SANDBOX_UNAVAILABLE");
      expect(calls).toBe(1);
    } finally {
      clockSpy.mockRestore();
    }
  });

  test("does not start a transport after the armed deadline has elapsed", async () => {
    let clock = 0n;
    let calls = 0;
    const clockSpy = vi.spyOn(process.hrtime, "bigint").mockImplementation(() => clock);
    try {
      queueMicrotask(() => {
        clock = 100n;
      });
      const result = await preflightLinuxRootlessOci(
        preflightInput(
          {
            run(command, _abortSignal, complete) {
              calls += 1;
              complete(successResponse(command));
            },
          },
          { deadlineNanoseconds: 50n },
        ),
      );

      expect(calls).toBe(0);
      expect(result).toMatchObject({
        reasonCode: "RP_SANDBOX_UNAVAILABLE",
        stage: "context",
      });
    } finally {
      clockSpy.mockRestore();
    }
  });

  test("enforces the absolute deadline even when an injected transport never settles", async () => {
    const started = performance.now();
    let transportSignal: AbortSignal | undefined;
    const result = await preflightLinuxRootlessOci(
      preflightInput(
        {
          run(_command, abortSignal) {
            transportSignal = abortSignal;
          },
        },
        { deadlineNanoseconds: process.hrtime.bigint() + 20_000_000n },
      ),
    );

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "context",
    });
    expect(transportSignal?.aborted).toBe(true);
  });

  test("does not collapse a deadline beyond the Node timer limit to one millisecond", async () => {
    const result = await preflightLinuxRootlessOci(
      preflightInput(
        {
          run(command, abortSignal, complete) {
            setTimeout(() => {
              expect(abortSignal.aborted).toBe(false);
              complete(successResponse(command));
            }, 10);
          },
        },
        {
          deadlineNanoseconds: process.hrtime.bigint() + (2_147_483_647n + 10_000n) * 1_000_000n,
        },
      ),
    );

    expect(result).toMatchObject({
      reasonCode: "RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED",
      stage: "live_probes_not_implemented",
    });
  });

  test("rejects accessor-driven transport responses without invoking the getter", async () => {
    let getterCalls = 0;
    const result = await preflightLinuxRootlessOci(
      preflightInput({
        run(_command, _abortSignal, complete) {
          const response = { exitCode: 0, stderr: "" } as Record<string, unknown>;
          Object.defineProperty(response, "stdout", {
            enumerable: true,
            get() {
              getterCalls += 1;
              return "{}";
            },
          });
          complete(response);
        },
      }),
    );

    expect(getterCalls).toBe(0);
    expect(result).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "context",
    });
  });

  test("does not assimilate thenable-shaped or Proxy transport responses", async () => {
    let thenGetterCalls = 0;
    let proxyGetCalls = 0;
    const thenableResult = await preflightLinuxRootlessOci(
      preflightInput({
        run(_command, _abortSignal, complete) {
          const response = { exitCode: 0, stdout: "{}", stderr: "" } as Record<string, unknown>;
          // biome-ignore lint/suspicious/noThenProperty: regression fixture models a thenable-shaped response.
          Object.defineProperty(response, "then", {
            get() {
              thenGetterCalls += 1;
              return undefined;
            },
          });
          complete(response);
        },
      }),
    );
    const proxyResult = await preflightLinuxRootlessOci(
      preflightInput({
        run(_command, _abortSignal, complete) {
          const response = new Proxy(
            { exitCode: 0, stdout: "{}", stderr: "" },
            {
              get(target, property, receiver) {
                proxyGetCalls += 1;
                return Reflect.get(target, property, receiver);
              },
            },
          );
          complete(response);
        },
      }),
    );

    expect(thenGetterCalls).toBe(0);
    expect(proxyGetCalls).toBe(0);
    expect(thenableResult).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "context",
    });
    expect(proxyResult).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "context",
    });
  });

  test("rejects accessor and Proxy inputs without evaluating caller code", async () => {
    let getterCalls = 0;
    let proxyTrapCalls = 0;
    const accessorInput = { ...preflightInput(successTransport()) } as Record<string, unknown>;
    Object.defineProperty(accessorInput, "approvedContext", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "desktop-linux";
      },
    });
    const proxyInput = new Proxy(preflightInput(successTransport()), {
      get() {
        proxyTrapCalls += 1;
        throw new Error("must remain inert");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls += 1;
        throw new Error("must remain inert");
      },
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error("must remain inert");
      },
    });

    const accessorResult = await preflightLinuxRootlessOci(
      accessorInput as LinuxRootlessOciPreflightInput,
    );
    const proxyResult = await preflightLinuxRootlessOci(proxyInput);

    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
    expect(accessorResult).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "input",
    });
    expect(proxyResult).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "input",
    });
  });

  test("does not obtain a missing transport capability from Object.prototype", async () => {
    let ambientRunCalls = 0;
    Object.defineProperty(Object.prototype, "run", {
      configurable: true,
      value: {
        enumerable: true,
        value(_command: unknown, _abortSignal: unknown, complete: (response: unknown) => void) {
          ambientRunCalls += 1;
          complete({ exitCode: 0, stdout: "{}", stderr: "" });
        },
      },
    });
    try {
      const result = await preflightLinuxRootlessOci(
        preflightInput({ extra: true } as unknown as OciPreflightTransport),
      );

      expect(ambientRunCalls).toBe(0);
      expect(result).toMatchObject({
        reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
        stage: "input",
      });
    } finally {
      Reflect.deleteProperty(Object.prototype, "run");
    }
  });

  test("does not replace an accessor transport capability with Object.prototype.value", async () => {
    let getterCalls = 0;
    let ambientRunCalls = 0;
    const transport = {} as Record<string, unknown>;
    Object.defineProperty(transport, "run", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value(_command: unknown, _abortSignal: unknown, complete: (response: unknown) => void) {
        ambientRunCalls += 1;
        complete({ exitCode: 0, stdout: "{}", stderr: "" });
      },
    });
    let result: Awaited<ReturnType<typeof preflightLinuxRootlessOci>> | undefined;
    try {
      result = await preflightLinuxRootlessOci(preflightInput(transport as OciPreflightTransport));
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
    }
    expect(getterCalls).toBe(0);
    expect(ambientRunCalls).toBe(0);
    expect(result).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "input",
    });
  });

  test("maps a revoked input Proxy to a frozen safety result", async () => {
    const revocable = Proxy.revocable(preflightInput(successTransport()), {});
    revocable.revoke();

    const result = await preflightLinuxRootlessOci(revocable.proxy);

    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toMatchObject({
      reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
      stage: "input",
    });
  });
});
