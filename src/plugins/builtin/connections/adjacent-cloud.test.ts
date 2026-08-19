import { describe, expect, test } from "bun:test";
import { ADJACENT_CLOUD_PROVIDER_IDS, adjacentCloudDataUrl } from "./adjacent-cloud";

describe("adjacentCloudDataUrl", () => {
  test("builds same-origin keyed-data paths", () => {
    expect(adjacentCloudDataUrl("llm-stats", "v1/models")).toBe("/api/data/llm-stats/v1/models");
    expect(adjacentCloudDataUrl("adjacent", "public/markets", "limit=5")).toBe(
      "/api/data/adjacent/public/markets?limit=5",
    );
  });

  test("fork-only data plugins are the Adjacent Cloud provider set", () => {
    expect([...ADJACENT_CLOUD_PROVIDER_IDS].sort()).toEqual([
      "adjacent",
      "llm-stats",
      "nws-cli",
      "twc-kalshi",
      "votehub",
    ]);
  });
});
