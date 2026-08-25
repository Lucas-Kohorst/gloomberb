import { describe, expect, test } from "bun:test";
import {
  ADJACENT_CLOUD_CONNECTION_ID,
  ADJACENT_CLOUD_PROVIDER_IDS,
  adjacentCloudDataUrl,
  isAdjacentCloudChildSourceId,
  keyedDataUrl,
  resolveConnectionSourceId,
} from "./adjacent-cloud";

describe("keyedDataUrl", () => {
  test("builds same-origin keyed-data paths", () => {
    expect(keyedDataUrl("llm-stats", "v1/models")).toBe("/api/data/llm-stats/v1/models");
    expect(keyedDataUrl("adjacent", "public/markets", "limit=5")).toBe(
      "/api/data/adjacent/public/markets?limit=5",
    );
    expect(keyedDataUrl("world-bank", "v2/country/all/indicator/SP.POP.TOTL")).toBe(
      "/api/data/world-bank/v2/country/all/indicator/SP.POP.TOTL",
    );
  });

  test("adjacentCloudDataUrl is a deprecated alias of keyedDataUrl", () => {
    expect(adjacentCloudDataUrl("owid", "charts", "q=gdp")).toBe(
      keyedDataUrl("owid", "charts", "q=gdp"),
    );
  });
});

describe("Adjacent Cloud connection folding", () => {
  test("provider set covers settlement and reference prints, not research origins", () => {
    expect([...ADJACENT_CLOUD_PROVIDER_IDS].sort()).toEqual([
      "adjacent",
      "llm-stats",
      "nws-cli",
      "owid",
      "twc-kalshi",
      "us-listings",
      "votehub",
    ]);
    for (const id of ["world-bank", "opensky", "nasa-firms", "digitraffic-ais", "nasa-gibs"]) {
      expect(isAdjacentCloudChildSourceId(id)).toBe(false);
      expect(resolveConnectionSourceId(id)).toBe(id);
    }
  });

  test("folds child provider ids onto one Adjacent Cloud row, not each upstream", () => {
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

  test("maps leftover Yahoo fragment ids onto the Yahoo origin", () => {
    for (const id of ["yahoo-esg", "yahoo-screener", "yahoo-dividends", "yahoo-short-interest"]) {
      expect(resolveConnectionSourceId(id)).toBe("yahoo");
    }
  });
});
