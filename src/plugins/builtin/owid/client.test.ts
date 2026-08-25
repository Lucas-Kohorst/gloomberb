import { afterEach, describe, expect, test } from "bun:test";
import { keyedDataUrl } from "../connections/adjacent-cloud";

describe("OWID hosted URL", () => {
  afterEach(() => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("keyed-data path is slug plus entity code", () => {
    expect(keyedDataUrl("owid", "life-expectancy/USA")).toBe(
      "/api/data/owid/life-expectancy/USA",
    );
    expect(keyedDataUrl("owid", "charts", "q=gdp")).toBe("/api/data/owid/charts?q=gdp");
    expect(keyedDataUrl("owid", "meta/life-expectancy")).toBe(
      "/api/data/owid/meta/life-expectancy",
    );
  });
});
