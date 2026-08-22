import { describe, expect, test } from "vitest";
import {
  ARM_ISOLATION_POLICY_V1,
  armIsolationPolicyDigest,
  buildArmRunArgv,
} from "../src/backend/arm-isolation-policy.js";
import { REMOTE_COMMAND_REJECTION } from "../src/backend/remote-command.js";

const IMAGE = `docker.m.daocloud.io/library/node@sha256:${"a".repeat(64)}`;

function request(overrides: Partial<Parameters<typeof buildArmRunArgv>[0]> = {}) {
  return {
    armName: "rp-dev-path-001-s1-a1",
    imageDigestRef: IMAGE,
    environment: { PATH: "/usr/bin", HOME: "/home/arm" },
    assetHostDir: "/home/rp/assets/DEV-PATH-001",
    armHomeHostDir: "/home/rp/arms/rp-dev-path-001-s1-a1",
    workingDirectory: "/arm/assets",
    timeoutSeconds: 120,
    targetArgv: ["node", "fixture/assert-node-marker.mjs"],
    mode: "run" as const,
    ...overrides,
  };
}

describe("arm isolation policy", () => {
  test("policy record is frozen and versioned", () => {
    expect(Object.isFrozen(ARM_ISOLATION_POLICY_V1)).toBe(true);
    expect(ARM_ISOLATION_POLICY_V1.schema_version).toBe("runparity.arm-isolation-policy/v1");
    expect(ARM_ISOLATION_POLICY_V1.network).toBe("none");
    expect(ARM_ISOLATION_POLICY_V1.capabilities).toBe("drop_all");
    expect(ARM_ISOLATION_POLICY_V1.no_new_privileges).toBe(true);
    expect(ARM_ISOLATION_POLICY_V1.read_only_root_filesystem).toBe(true);
  });

  test("policy digest is stable and hex", () => {
    const digest = armIsolationPolicyDigest();
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(armIsolationPolicyDigest()).toBe(digest);
  });

  test("builds the full safety flag set", () => {
    const argv = buildArmRunArgv(request());
    const joined = argv.join(" ");
    for (const expected of [
      "--network none",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--read-only",
      "--userns keep-id:uid=10001,gid=10001",
      "--user 10001:10001",
      "--pids-limit 64",
      "--memory 536870912",
      "--cpus 1",
      "--tmpfs /tmp:rw,size=16m,mode=1777",
      "--workdir /arm/assets",
      "--timeout 120",
      IMAGE,
    ]) {
      expect(joined).toContain(expected);
    }
    expect(argv[argv.length - 2]).toBe("node");
    expect(argv[argv.length - 1]).toBe("fixture/assert-node-marker.mjs");
  });

  test("every generated token passes the remote allowlist", () => {
    const argv = buildArmRunArgv(
      request({
        environment: {
          PATH: "/arm/assets/wrong-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
        },
      }),
    );
    for (const token of argv) {
      expect(token, token).toMatch(/^[A-Za-z0-9_@%+=:,./-]+$/u);
    }
  });

  test("rejects tag-mutable image references", () => {
    expect(() => buildArmRunArgv(request({ imageDigestRef: "docker.io/library/node:22" }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
  });

  test("rejects unsafe environment values", () => {
    expect(() => buildArmRunArgv(request({ environment: { PATH: "/bin;rm -rf /" } }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
    expect(() => buildArmRunArgv(request({ environment: { BAD: "$(curl evil)" } }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
  });

  test("rejects unsafe target argv tokens", () => {
    expect(() => buildArmRunArgv(request({ targetArgv: ["node", "x;reboot"] }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
  });

  test("rejects non-slug arm names and bad paths", () => {
    expect(() => buildArmRunArgv(request({ armName: "Bad_Name" }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
    expect(() => buildArmRunArgv(request({ armHomeHostDir: "home/rp" }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
    expect(() => buildArmRunArgv(request({ workingDirectory: "/arm//assets" }))).toThrow(
      REMOTE_COMMAND_REJECTION,
    );
  });
});
