import { afterEach, describe, expect, test } from "bun:test";
import { adjacentCloudDataUrl } from "../connections/adjacent-cloud";

describe("OWID hosted URL", () => {
  afterEach(() => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("Adjacent Cloud path is slug plus entity code", () => {
    expect(adjacentCloudDataUrl("owid", "life-expectancy/USA")).toBe(
      "/api/data/owid/life-expectancy/USA",
    );
    expect(adjacentCloudDataUrl("owid", "charts", "q=gdp")).toBe("/api/data/owid/charts?q=gdp");
  });
});
