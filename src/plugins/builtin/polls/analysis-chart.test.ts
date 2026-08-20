import { describe, expect, test } from "bun:test";
import { buildPollAnalysisSeries } from "./analysis-chart";
import { normalizeVoteHubPoll } from "./normalize";
import {
  pickAdjacentMarketForPoll,
  pollRaceMarketQuery,
  scoreAdjacentMarketForPoll,
} from "./overlay";
import type { VoteHubPoll } from "./types";
import type { AdjacentMarket } from "../adjacent/types";

function makePoll(overrides: Partial<VoteHubPoll> = {}): VoteHubPoll {
  return {
    id: "p1",
    poll_type: "us-senator",
    sample_size: 800,
    population: "lv",
    url: null,
    created_at: null,
    start_date: "2026-01-01",
    end_date: "2026-01-03",
    pollster: "EPIC-MRA",
    answers: [
      { choice: "Slotkin", pct: 46 },
      { choice: "Rogers", pct: 42 },
    ],
    seat_name: null,
    sponsors: [],
    internal: false,
    partisan: null,
    subject: "2026 Michigan",
    ...overrides,
  };
}

function market(overrides: Partial<AdjacentMarket>): AdjacentMarket {
  return {
    id: "m1",
    platform: "kalshi",
    title: "Will Slotkin win the 2026 Michigan Senate race?",
    status: "open",
    yes_price: 52,
    no_price: 48,
    ...overrides,
  };
}

describe("poll race market overlay matching", () => {
  test("builds a senate race query from subject + office + choice", () => {
    const row = normalizeVoteHubPoll(makePoll());
    expect(pollRaceMarketQuery(row, "Slotkin")).toBe("2026 Michigan senate Slotkin");
  });

  test("picks the Adjacent market that shares race tokens, not the first result", () => {
    const query = "2026 Michigan senate Slotkin";
    const miss = market({
      id: "noise",
      title: "Fed cuts rates in 2026?",
    });
    const hit = market({ id: "mi-sen" });
    expect(scoreAdjacentMarketForPoll(hit, query)).toBeGreaterThan(scoreAdjacentMarketForPoll(miss, query));
    expect(pickAdjacentMarketForPoll([miss, hit], query)?.id).toBe("mi-sen");
    expect(pickAdjacentMarketForPoll([miss], query)).toBeNull();
  });
});

describe("poll analysis chart series", () => {
  const rows = [
    makePoll({ id: "a", pollster: "EPIC-MRA", end_date: "2026-01-10", answers: [{ choice: "Slotkin", pct: 46 }, { choice: "Rogers", pct: 42 }] }),
    makePoll({ id: "b", pollster: "EPIC-MRA", end_date: "2026-03-10", answers: [{ choice: "Slotkin", pct: 49 }, { choice: "Rogers", pct: 40 }] }),
    makePoll({ id: "c", pollster: "Trafalgar", end_date: "2026-02-10", answers: [{ choice: "Slotkin", pct: 44 }, { choice: "Rogers", pct: 45 }] }),
  ].map(normalizeVoteHubPoll);
  const poll = rows[0]!;
  const palette = ["#11aa55", "#ddaa00", "#4488ff"];

  test("house overlay is one pollster line series", () => {
    const series = buildPollAnalysisSeries({
      rows,
      poll,
      choice: "Slotkin",
      group: "house",
      view: "overlay",
      palette,
    });
    expect(series[0]!.id).toBe("pollster:EPIC-MRA");
    expect(series[0]!.style).toBe("line");
    expect(series[0]!.points.map((point) => point.value)).toEqual([46, 49]);
    expect(series.some((entry) => entry.id.includes("Trafalgar"))).toBe(false);
  });

  test("race overlay and scatter reuse CompositeChart styles", () => {
    const overlay = buildPollAnalysisSeries({
      rows,
      poll,
      choice: "Slotkin",
      group: "race",
      view: "overlay",
      palette,
    });
    const scatter = buildPollAnalysisSeries({
      rows,
      poll,
      choice: "Slotkin",
      group: "race",
      view: "scatter",
      palette,
      market: {
        marketId: "mi-sen",
        label: "PM Michigan Senate",
        points: [{ date: new Date("2026-02-01T00:00:00Z"), close: 51 }],
      },
    });
    expect(overlay.map((entry) => entry.id)).toEqual(["pollster:EPIC-MRA", "pollster:Trafalgar"]);
    expect(overlay.every((entry) => entry.style === "line")).toBe(true);
    expect(scatter.filter((entry) => entry.id.startsWith("pollster:")).every((entry) => entry.style === "points")).toBe(true);
    expect(scatter.at(-1)).toMatchObject({ id: "pm:mi-sen", style: "line", label: "PM Michigan Senate" });
    expect(scatter.at(-1)!.points[0]!.value).toBe(51);
  });
});
