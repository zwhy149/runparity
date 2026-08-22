import { describe, expect, test } from "vitest";
import { describeControllerRuntime } from "../src/controller-runtime.js";

describe("controller runtime support", () => {
  test("labels Node 18 and 20 as EOL compatibility runtimes", () => {
    expect(describeControllerRuntime("18.20.8")).toEqual({
      name: "node",
      version: "18.20.8",
      support_status: "eol_compatibility",
      warning: {
        code: "RP_CONTROLLER_NODE_EOL",
        message:
          "RunParity supports this EOL Node.js line for diagnosis compatibility; use an active LTS line for normal development.",
      },
    });
    expect(describeControllerRuntime("20.19.5").support_status).toBe("eol_compatibility");
  });

  test("does not warn on the supported Node 22 and 24 LTS lines", () => {
    expect(describeControllerRuntime("22.22.0")).toMatchObject({
      support_status: "supported_lts",
      warning: null,
    });
    expect(describeControllerRuntime("24.15.0")).toMatchObject({
      support_status: "supported_lts",
      warning: null,
    });
  });
});
