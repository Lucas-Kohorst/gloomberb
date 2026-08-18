import { describe, expect, test } from "bun:test";
import { normalizeBuiltinPluginStateMap } from "./ownership";

describe("normalizeBuiltinPluginStateMap", () => {
  test("lifts Adjacent API key out of the former Gloom Cloud namespace", () => {
    expect(normalizeBuiltinPluginStateMap({
      "gloomberb-cloud": {
        adjacentApiKey: "adj-key",
        other: true,
      },
      portfolio: { mode: "live" },
    })).toEqual({
      "gloomberb-cloud": { other: true },
      adjacent: { adjacentApiKey: "adj-key" },
      portfolio: { mode: "live" },
    });
  });

  test("does not overwrite an existing Adjacent key", () => {
    expect(normalizeBuiltinPluginStateMap({
      "gloomberb-cloud": { adjacentApiKey: "old" },
      adjacent: { adjacentApiKey: "new" },
    })).toEqual({
      "gloomberb-cloud": {},
      adjacent: { adjacentApiKey: "new" },
    });
  });
});
