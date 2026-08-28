import { describe, expect, test } from "bun:test";
import { newsOriginLabel } from "./origins";

describe("newsOriginLabel", () => {
  test("labels the cloud wire as Wire, including the old desktop stamp", () => {
    expect(newsOriginLabel("gloomberb-cloud")).toBe("Wire");
    expect(newsOriginLabel("desktop-backend")).toBe("Wire");
    expect(newsOriginLabel("asset-data-router")).toBe("Wire");
    expect(newsOriginLabel("rss")).toBe("RSS");
  });
});
