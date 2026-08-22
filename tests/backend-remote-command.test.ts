import { describe, expect, test } from "vitest";
import {
  isSafeRemoteArg,
  joinRemoteArgv,
  REMOTE_COMMAND_REJECTION,
} from "../src/backend/remote-command.js";

describe("remote command allowlist", () => {
  test("joins safe tokens with spaces", () => {
    expect(joinRemoteArgv(["podman", "ps", "-a", "--format", "json"])).toBe(
      "podman ps -a --format json",
    );
  });

  test("accepts path, colon, comma, equals, dot, dash, at, percent, plus tokens", () => {
    expect(isSafeRemoteArg("/home/rp/probe/x.mjs")).toBe(true);
    expect(isSafeRemoteArg("keep-id:uid=10001,gid=10001")).toBe(true);
    expect(isSafeRemoteArg(`docker.m.daocloud.io/library/node@sha256:${"a".repeat(64)}`)).toBe(
      true,
    );
    expect(isSafeRemoteArg("--flag=value")).toBe(true);
  });

  test("rejects shell-significant characters", () => {
    for (const bad of [
      "a b",
      "a;b",
      "a|b",
      "a&b",
      "$(x)",
      "`x`",
      "a>b",
      "'quote'",
      '"quote"',
      "a*b",
      "a?b",
      "[x]",
      "{x}",
      "a\\b",
      "NEW\nLINE",
      "",
      "tab\tchar",
    ]) {
      expect(isSafeRemoteArg(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("joinRemoteArgv fails closed on the first unsafe token", () => {
    expect(() => joinRemoteArgv(["ok", "rm -rf /"])).toThrow(REMOTE_COMMAND_REJECTION);
    expect(() => joinRemoteArgv([])).toThrow(REMOTE_COMMAND_REJECTION);
  });
});
