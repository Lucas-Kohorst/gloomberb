import { describe, expect, test } from "bun:test";
import { adjacentCloudDataUrl } from "./adjacent-cloud";

describe("adjacentCloudDataUrl", () => {
  test("builds same-origin keyed-data paths", () => {
    expect(adjacentCloudDataUrl("llm-stats", "v1/models")).toBe("/api/data/llm-stats/v1/models");
    expect(adjacentCloudDataUrl("jina-ai", "read", "url=https://example.com")).toBe(
      "/api/data/jina-ai/read?url=https://example.com",
    );
  });
});
