import { describe, expect, test } from "bun:test";
import type { QuoteSummaryResponse } from "../../../sources/yahoo-finance/types";
import { buildEsgData, esgUnavailableMessage, hasEsgData, isYahooEsgUnavailable, normalizeEsgScores } from "./client";
import type { EsgScores } from "./types";

function quoteSummaryWithEsg(esg: Record<string, unknown> | null): QuoteSummaryResponse {
  return {
    quoteSummary: {
      result: [{ esgScores: esg as any }],
    },
  };
}

describe("normalizeEsgScores", () => {
  test("reads esgScores from quoteSummary.result[0]", () => {
    const data = quoteSummaryWithEsg({
      totalEsg: { raw: 25 },
      environmentScore: { raw: 8 },
      socialScore: { raw: 9 },
      governanceScore: { raw: 8 },
      esgPerformance: "UNDER_PERFORM",
      peerCount: 12,
      peerGroup: "Software—Infrastructure",
      peerEsgScore: { raw: 15 },
      peerEnvironmentScore: { raw: 4 },
      peerSocialScore: { raw: 5 },
      peerGovernanceScore: { raw: 6 },
      controversyLevel: "MODERATE",
      controversyScore: { raw: 2 },
      ratingMonth: 1,
      ratingYear: 2024,
    });

    const result = data.quoteSummary!.result![0]!;
    const scores = normalizeEsgScores(result);

    expect(scores).toEqual<EsgScores>({
      totalEsg: 25,
      environmentScore: 8,
      socialScore: 9,
      governanceScore: 8,
      esgPerformance: "UNDER_PERFORM",
      peerCount: 12,
      peerGroup: "Software—Infrastructure",
      peerEsgScore: 15,
      peerEnvironmentScore: 4,
      peerSocialScore: 5,
      peerGovernanceScore: 6,
      controversyLevel: "MODERATE",
      controversyScore: 2,
      ratingMonth: 1,
      ratingYear: 2024,
    });
  });

  test("returns all-null scores when esgScores module is missing", () => {
    const scores = normalizeEsgScores({});
    expect(scores.totalEsg).toBeNull();
    expect(scores.environmentScore).toBeNull();
    expect(scores.esgPerformance).toBeNull();
    expect(scores.peerGroup).toBeNull();
  });

  test("treats maxAge-only Yahoo payloads as empty scores", () => {
    const data = quoteSummaryWithEsg({ maxAge: 86400 });
    const result = data.quoteSummary!.result![0]!;
    const scores = normalizeEsgScores(result);
    expect(hasEsgData(scores)).toBe(false);
    expect(scores.totalEsg).toBeNull();
    expect(scores.environmentScore).toBeNull();
    expect(scores.socialScore).toBeNull();
    expect(scores.governanceScore).toBeNull();
  });

  test("handles bare numeric values without { raw } wrappers", () => {
    const data = quoteSummaryWithEsg({
      totalEsg: 30,
      environmentScore: 10,
      socialScore: 12,
      governanceScore: 8,
      peerCount: 5,
      ratingMonth: 6,
      ratingYear: 2023,
    });

    const result = data.quoteSummary!.result![0]!;
    const scores = normalizeEsgScores(result);

    expect(scores.totalEsg).toBe(30);
    expect(scores.environmentScore).toBe(10);
    expect(scores.socialScore).toBe(12);
    expect(scores.governanceScore).toBe(8);
    expect(scores.peerCount).toBe(5);
    expect(scores.ratingMonth).toBe(6);
    expect(scores.ratingYear).toBe(2023);
  });

  test("ignores empty strings for performance and peer group", () => {
    const data = quoteSummaryWithEsg({
      esgPerformance: "",
      peerGroup: "",
      controversyLevel: "",
    });

    const result = data.quoteSummary!.result![0]!;
    const scores = normalizeEsgScores(result);

    expect(scores.esgPerformance).toBeNull();
    expect(scores.peerGroup).toBeNull();
    expect(scores.controversyLevel).toBeNull();
  });
});

describe("hasEsgData", () => {
  test("true when totalEsg is present", () => {
    expect(hasEsgData({ ...emptyScores(), totalEsg: 20 })).toBe(true);
  });

  test("true when esgPerformance is present even without numeric scores", () => {
    expect(hasEsgData({ ...emptyScores(), esgPerformance: "IN_LINE" })).toBe(true);
  });

  test("false when all fields are null", () => {
    expect(hasEsgData(emptyScores())).toBe(false);
  });

  test("true when only peer or controversy fields are present", () => {
    expect(hasEsgData({ ...emptyScores(), peerGroup: "Software" })).toBe(true);
    expect(hasEsgData({ ...emptyScores(), controversyLevel: "LOW" })).toBe(true);
  });
});

describe("buildEsgData", () => {
  test("empty Yahoo scores are a no-data payload, not an error", () => {
    const data = buildEsgData("IBIT", { esgScores: { maxAge: 86400 } as never });
    expect(hasEsgData(data.scores)).toBe(false);
    expect(data.carbon).toBeNull();
    expect(data.symbol).toBe("IBIT");
    expect(data.sourceUrl).toContain("IBIT");
  });
});

describe("isYahooEsgUnavailable", () => {
  test("treats Yahoo 404 fundamentals JSON as no data, not a crash dump", () => {
    const raw = '[404] {"quoteSummary":{"result":null,"error":{"code":"Not Found","description":"No fundamentals data for AAPL"}}}';
    expect(isYahooEsgUnavailable(new Error(raw))).toBe(true);
    expect(isYahooEsgUnavailable(new Error("No quote summary for AAPL"))).toBe(true);
    expect(isYahooEsgUnavailable(new Error("[429] Too Many Requests"))).toBe(false);
    expect(esgUnavailableMessage("AAPL")).toBe("AAPL has no Yahoo ESG scores.");
  });
});

function emptyScores(): EsgScores {
  return {
    totalEsg: null,
    environmentScore: null,
    socialScore: null,
    governanceScore: null,
    esgPerformance: null,
    peerCount: null,
    peerGroup: null,
    peerEsgScore: null,
    peerEnvironmentScore: null,
    peerSocialScore: null,
    peerGovernanceScore: null,
    controversyLevel: null,
    controversyScore: null,
    ratingMonth: null,
    ratingYear: null,
  };
}
