import { describe, expect, test } from "bun:test";
import {
  ADJACENT_CLOUD_CONNECTION_ID,
  ADJACENT_CLOUD_PROVIDER_IDS,
  adjacentCloudDataUrl,
  isAdjacentCloudChildSourceId,
  resolveConnectionSourceId,
} from "./adjacent-cloud";

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

  test("folds child provider ids onto the Adjacent Cloud connection", () => {
    expect(ADJACENT_CLOUD_CONNECTION_ID).toBe("adjacent-cloud");
    for (const id of ADJACENT_CLOUD_PROVIDER_IDS) {
      expect(isAdjacentCloudChildSourceId(id)).toBe(true);
      expect(resolveConnectionSourceId(id)).toBe(ADJACENT_CLOUD_CONNECTION_ID);
    }
    expect(isAdjacentCloudChildSourceId(ADJACENT_CLOUD_CONNECTION_ID)).toBe(false);
    expect(resolveConnectionSourceId(ADJACENT_CLOUD_CONNECTION_ID)).toBe(ADJACENT_CLOUD_CONNECTION_ID);
    expect(resolveConnectionSourceId("yahoo")).toBe("yahoo");
    expect(resolveConnectionSourceId("ai-anthropic")).toBe("ai-anthropic");
  });
});
