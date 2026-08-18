import { describe, expect, test } from "bun:test";
import {
  aaCatalogMetricsForRow,
  aaChartExpression,
  aaMetricValue,
  blendedPrice,
  canonicalAaMetric,
  costAdjustedScore,
  filterAaRows,
  matchingAaRows,
} from "./normalize";
import type { AaModelRow } from "./types";

function language(overrides: Partial<AaModelRow> = {}): AaModelRow {
  return {
    id: "gpt-4o",
    slug: "gpt-4o",
    name: "GPT-4o",
    creator: "OpenAI",
    creatorSlug: "openai",
    family: "language",
    category: "language",
    releaseDate: "2024-05-13",
    url: "https://artificialanalysis.ai/models/gpt-4o",
    intelligence: 40,
    coding: 38,
    agentic: 36,
    speed: 80,
    ttftSeconds: 0.4,
    e2eSeconds: 2.1,
    inputPrice: 2.5,
    outputPrice: 10,
    elo: null,
    ci95: null,
    bba: null,
    fdb: null,
    tau: null,
    wer: null,
    ...overrides,
  };
}

describe("artificial analysis mapping", () => {
  test("aliases legacy llm-stats metric codes onto AA fields", () => {
    const row = language();
    expect(canonicalAaMetric("tps")).toBe("speed");
    expect(aaMetricValue(row, "tps")).toBe(80);
    expect(aaMetricValue(row, "p95")).toBe(2.1);
    expect(aaChartExpression(row, "intelligence")).toBe("BENCH:gpt-4o:intelligence");
  });

  test("catalog rows omit null metrics and keep scored ones", () => {
    const row = language({ coding: null, inputPrice: null });
    const metrics = aaCatalogMetricsForRow(row).map((metric) => metric.code);
    expect(metrics).toContain("intelligence");
    expect(metrics).toContain("speed");
    expect(metrics).not.toContain("coding");
    expect(metrics).not.toContain("input");
  });

  test("cost-adjusted score uses equal input/output blend", () => {
    const cheap = language({ id: "cheap", slug: "cheap", intelligence: 10, inputPrice: 1, outputPrice: 1 });
    const expensive = language({ id: "exp", slug: "exp", intelligence: 20, inputPrice: 5, outputPrice: 5 });
    expect(blendedPrice(cheap)).toBe(1);
    expect(costAdjustedScore(cheap.intelligence ?? 0, cheap)).toBe(10);
    expect(costAdjustedScore(expensive.intelligence ?? 0, expensive)).toBe(4);
  });

  test("matches selector by slug, name, or creator", () => {
    const rows = [
      language(),
      language({ id: "claude", slug: "claude-sonnet-4", name: "Claude Sonnet 4", creator: "Anthropic", creatorSlug: "anthropic" }),
    ];
    expect(matchingAaRows(rows, "OpenAI").map((row) => row.slug)).toEqual(["gpt-4o"]);
    expect(matchingAaRows(rows, "claude-sonnet-4")[0]?.name).toBe("Claude Sonnet 4");
  });

  test("tab filters keep language vs media families separate", () => {
    const rows = [
      language(),
      language({
        id: "img",
        slug: "flux",
        name: "Flux",
        family: "image",
        category: "text-to-image",
        intelligence: null,
        elo: 1200,
      }),
    ];
    expect(filterAaRows(rows, "intelligence", "").every((row) => row.family === "language")).toBe(true);
    expect(filterAaRows(rows, "image", "flux")).toHaveLength(1);
  });
});
