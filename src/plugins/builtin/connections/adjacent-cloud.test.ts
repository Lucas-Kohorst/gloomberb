import { describe, expect, test } from "bun:test";
import { ADJACENT_CLOUD_PROVIDER_IDS, adjacentCloudDataUrl } from "./adjacent-cloud";

describe("adjacentCloudDataUrl", () => {
  test("builds same-origin keyed-data paths", () => {
    expect(adjacentCloudDataUrl("llm-stats", "v1/models")).toBe("/api/data/llm-stats/v1/models");
    expect(adjacentCloudDataUrl("adjacent", "public/markets", "limit=5")).toBe(
      "/api/data/adjacent/public/markets?limit=5",
    );
  });

  test("Adjacent Cloud provider set covers settlement and reference prints", () => {
    expect([...ADJACENT_CLOUD_PROVIDER_IDS].sort()).toEqual([
      "adjacent",
      "llm-stats",
      "nws-cli",
      "owid",
      "twc-kalshi",
      "us-listings",
      "votehub",
    ]);
  });
});
