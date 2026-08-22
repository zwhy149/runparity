import { describe, expect, test } from "vitest";
import { snapshotExactDataRecord } from "../src/inert-snapshot.js";

describe("exact inert data-record snapshot", () => {
  test("captures exact own enumerable data properties into a frozen null-prototype record", () => {
    const candidate = { beta: 2, alpha: 1 };
    const snapshot = snapshotExactDataRecord(candidate, ["alpha", "beta"] as const);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.["alpha"]).toBe(1);
    expect(snapshot?.["beta"]).toBe(2);
    expect(Object.keys(snapshot ?? {})).toEqual(["alpha", "beta"]);
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
    candidate.alpha = 99;
    expect(snapshot?.["alpha"]).toBe(1);
  });

  test("accepts a null-prototype source without widening its exact key set", () => {
    const candidate = Object.assign(Object.create(null) as Record<string, unknown>, {
      value: "captured",
    });
    expect(snapshotExactDataRecord(candidate, ["value"] as const)?.["value"]).toBe("captured");
  });

  test("rejects an exact-key record with a custom prototype", () => {
    const prototype = { inherited: true };
    const candidate = Object.assign(Object.create(prototype) as Record<string, unknown>, {
      alpha: 1,
    });

    expect(snapshotExactDataRecord(candidate, ["alpha"] as const)).toBeNull();
  });

  test.each([
    ["primitive", "value"],
    ["array", [1]],
    ["function", () => undefined],
    ["date", new Date(0)],
    ["missing key", { alpha: 1 }],
    ["extra key", { alpha: 1, beta: 2, extra: 3 }],
  ])("rejects %s candidates", (_name, candidate) => {
    expect(snapshotExactDataRecord(candidate, ["alpha", "beta"] as const)).toBeNull();
  });

  test("rejects symbol, hidden, and accessor properties without invoking getters", () => {
    const withSymbol = { alpha: 1, beta: 2 };
    Object.defineProperty(withSymbol, Symbol("extra"), { enumerable: true, value: 3 });
    expect(snapshotExactDataRecord(withSymbol, ["alpha", "beta"] as const)).toBeNull();

    const hidden = { alpha: 1, beta: 2 };
    Object.defineProperty(hidden, "beta", { enumerable: false, value: 2 });
    expect(snapshotExactDataRecord(hidden, ["alpha", "beta"] as const)).toBeNull();

    let getterCalls = 0;
    const accessor = { alpha: 1 } as Record<string, unknown>;
    Object.defineProperty(accessor, "beta", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 2;
      },
    });
    expect(snapshotExactDataRecord(accessor, ["alpha", "beta"] as const)).toBeNull();
    expect(getterCalls).toBe(0);
  });

  test("rejects extra non-enumerable properties, including thenable-shaped accessors", () => {
    let thenGetterCalls = 0;
    const candidate = { alpha: 1 };
    const thenKey = ["th", "en"].join("");
    Object.defineProperty(candidate, thenKey, {
      configurable: true,
      get() {
        thenGetterCalls += 1;
        return () => undefined;
      },
    });

    expect(snapshotExactDataRecord(candidate, ["alpha"] as const)).toBeNull();
    expect(thenGetterCalls).toBe(0);
  });

  test("rejects live and revoked proxies before invoking traps", () => {
    let trapCalls = 0;
    const proxy = new Proxy(
      { alpha: 1 },
      {
        get(target, property, receiver) {
          trapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    expect(snapshotExactDataRecord(proxy, ["alpha"] as const)).toBeNull();
    expect(trapCalls).toBe(0);

    const revoked = Proxy.revocable({ alpha: 1 }, {});
    revoked.revoke();
    expect(snapshotExactDataRecord(revoked.proxy, ["alpha"] as const)).toBeNull();
  });

  test("does not assimilate a function-valued data property", () => {
    let functionCalls = 0;
    const key = "run";
    const candidate = Object.create(null) as Record<string, unknown>;
    candidate[key] = () => {
      functionCalls += 1;
    };
    const snapshot = snapshotExactDataRecord(candidate, [key] as const);

    expect(snapshot?.[key]).toBe(candidate[key]);
    expect(functionCalls).toBe(0);
  });

  test("refuses a then policy key instead of returning a thenable-shaped snapshot", () => {
    let thenCalls = 0;
    const key = ["th", "en"].join("");
    const candidate = Object.create(null) as Record<string, unknown>;
    candidate[key] = () => {
      thenCalls += 1;
    };

    expect(snapshotExactDataRecord(candidate, [key] as const)).toBeNull();
    expect(thenCalls).toBe(0);
  });

  test("keeps nested leaves opaque without traversing or freezing caller-owned values", () => {
    let nestedGetterCalls = 0;
    const nested = {} as Record<string, unknown>;
    Object.defineProperty(nested, "active", {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return true;
      },
    });

    const snapshot = snapshotExactDataRecord({ nested }, ["nested"] as const);

    expect(snapshot?.["nested"]).toBe(nested);
    expect(Object.isFrozen(nested)).toBe(false);
    expect(nestedGetterCalls).toBe(0);
  });

  test("does not satisfy a missing expected key from a polluted descriptor prototype", () => {
    const pollutedKey = "runparityMissingDescriptor";
    Object.defineProperty(Object.prototype, pollutedKey, {
      configurable: true,
      value: { enumerable: true, value: "ambient" },
    });
    try {
      expect(snapshotExactDataRecord({ extra: true }, [pollutedKey] as const)).toBeNull();
    } finally {
      Reflect.deleteProperty(Object.prototype, pollutedKey);
    }
  });

  test("does not treat an inherited descriptor value as an own data property", () => {
    let getterCalls = 0;
    const candidate = {} as Record<string, unknown>;
    Object.defineProperty(candidate, "alpha", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "caller code";
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "ambient",
    });
    let snapshot: ReturnType<typeof snapshotExactDataRecord>;
    try {
      snapshot = snapshotExactDataRecord(candidate, ["alpha"] as const);
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
    }
    expect(snapshot).toBeNull();
    expect(getterCalls).toBe(0);
  });
});
