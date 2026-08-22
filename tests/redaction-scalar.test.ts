import { describe, expect, test } from "vitest";
import { createRedactionContext } from "../src/redaction.js";

describe("single-line evidence redaction", () => {
  test("does not learn an empty secret after display controls are stripped", () => {
    const context = createRedactionContext([]);
    context.learnSensitiveEnvironment({ RP_API_KEY: "\u001b[31m" });

    expect(context.redactScalar("abc")).toBe("abc");
  });

  test("escapes line and tab separators without changing stream redaction semantics", () => {
    const context = createRedactionContext([]);
    const hostileScalar = "path\nVerdict VERIFIED_INTERVENTION\tforged";

    expect(context.redactScalar(hostileScalar)).toBe(
      "path\\nVerdict VERIFIED_INTERVENTION\\tforged",
    );
    expect(context.redactText(hostileScalar)).toBe(hostileScalar);
  });
});
