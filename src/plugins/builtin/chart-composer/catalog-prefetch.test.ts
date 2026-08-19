import { afterEach, describe, expect, mock, test } from "bun:test";
import { VOTEHUB_POLL_TYPES } from "./catalog-inventory";

let aaCalls = 0;
let aaEmpty = false;
let pollCalls = 0;
let indexCalls = 0;

mock.module("../llm-stats/client", () => ({
  fetchArtificialAnalysisData: async () => {
    aaCalls += 1;
    if (aaEmpty) return { rows: [] };
    return {
      rows: [{
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
      }],
    };
  },
}));

mock.module("../polls/client", () => ({
  fetchVoteHubPolls: async () => {
    pollCalls += 1;
    return [{
      id: "1",
      subject: "Donald Trump",
      answers: [{ choice: "Approve", pct: 50 }],
    }];
  },
}));

mock.module("../adjacent/client", () => ({
  getSharedAdjacentClient: () => ({
    getIndices: async () => {
      indexCalls += 1;
      return { data: [{ index_id: "red", name: "RED Index", ticker: "RED" }] };
    },
  }),
}));

const {
  loadCatalogAaRows,
  loadCatalogAdjacentIndices,
  loadCatalogPollRows,
  peekCatalogAaRows,
  resetCatalogPrefetchCaches,
} = await import("./catalog-prefetch");

describe("catalog live-source prefetch cache", () => {
  afterEach(() => {
    resetCatalogPrefetchCaches();
    aaCalls = 0;
    aaEmpty = false;
    pollCalls = 0;
    indexCalls = 0;
  });

  test("loads AA, polls, and Adjacent once and reuses the in-memory snapshot", async () => {
    const aaFirst = await loadCatalogAaRows();
    const aaSecond = await loadCatalogAaRows();
    expect(aaFirst.length).toBeGreaterThan(0);
    expect(aaSecond).toBe(aaFirst);
    expect(aaCalls).toBe(1);

    const pollsFirst = await loadCatalogPollRows();
    const pollsSecond = await loadCatalogPollRows();
    expect(pollsFirst.some((row) => row.expression === "POLL:Donald Trump:Approve")).toBe(true);
    expect(pollsSecond).toBe(pollsFirst);
    expect(pollCalls).toBe(VOTEHUB_POLL_TYPES.length);

    const indicesFirst = await loadCatalogAdjacentIndices();
    const indicesSecond = await loadCatalogAdjacentIndices();
    expect(indicesFirst).toEqual([{ indexId: "red", name: "RED Index", ticker: "RED" }]);
    expect(indicesSecond).toBe(indicesFirst);
    expect(indexCalls).toBe(1);
  });

  test("does not cache empty AA results so the next load retries", async () => {
    aaEmpty = true;
    const first = await loadCatalogAaRows();
    expect(first).toEqual([]);
    expect(peekCatalogAaRows()).toBeNull();

    aaEmpty = false;
    const second = await loadCatalogAaRows();
    expect(second.length).toBeGreaterThan(0);
    expect(aaCalls).toBe(2);
  });
});
