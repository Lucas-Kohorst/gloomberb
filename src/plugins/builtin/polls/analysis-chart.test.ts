import { describe, expect, test } from "bun:test";
import {
  buildPollAnalysisSeries,
  clipPricePointsToWindow,
  pollSeriesTimeWindow,
} from "./analysis-chart";
import { normalizeVoteHubPoll } from "./normalize";
import {
  loadPollRaceMarketOverlay,
  pickAdjacentMarketForPoll,
  pollRaceGeography,
  pollRaceMarketQuery,
  scoreAdjacentMarketForPoll,
} from "./overlay";
import type { VoteHubPoll } from "./types";
import type { AdjacentMarket } from "../adjacent/types";
import { venueChartHitFromAdjacentMarket } from "../chart-composer/prediction-series";

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
    id: "kalshi:KXMI2026",
    platform: "kalshi",
    slug: "KXMI-SEN-2026",
    title: "Will Slotkin win the 2026 Michigan Senate race?",
    status: "open",
    yes_price: 52,
    no_price: 48,
    ...overrides,
  };
}

describe("poll race market overlay matching", () => {
  test("builds a senate race query and geography from subject", () => {
    const row = normalizeVoteHubPoll(makePoll());
    expect(pollRaceMarketQuery(row, "Slotkin")).toBe("2026 Michigan senate Slotkin");
    expect(pollRaceGeography(row)).toBe("michigan");
  });

  test("maps Adjacent hits onto the same KALSHI/POLY ids the chart catalog uses", () => {
    expect(venueChartHitFromAdjacentMarket(market({}))).toEqual({
      venue: "kalshi",
      marketId: "KXMI-SEN-2026",
      title: "Will Slotkin win the 2026 Michigan Senate race?",
    });
  });

  test("rejects a different state's market even when the year matches", () => {
    const query = "2026 Michigan senate Slotkin";
    const texas = market({
      id: "noise",
      slug: "KXTX-SEN-2026",
      title: "Will Cruz win the 2026 Texas Senate race?",
    });
    const michigan = market({ id: "mi-sen" });
    expect(scoreAdjacentMarketForPoll(texas, query, "michigan")).toBe(0);
    expect(pickAdjacentMarketForPoll([texas, michigan], query, "michigan")?.id).toBe("mi-sen");
    expect(pickAdjacentMarketForPoll([texas], query, "michigan")).toBeNull();
  });

  test("loadPollRaceMarketOverlay returns a Promise, not an uninvoked async function", async () => {
    const row = normalizeVoteHubPoll(makePoll());
    const pending = loadPollRaceMarketOverlay(row, "Slotkin", {
      search: async () => [market({})],
      series: async () => ({
        label: "Michigan Senate",
        points: [{ date: new Date("2026-02-01T00:00:00Z"), close: 51 }],
      }),
    });
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toMatchObject({
      marketId: "KXMI-SEN-2026",
      venue: "kalshi",
    });
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
  const marketOverlay = {
    marketId: "KXMI-SEN-2026",
    venue: "kalshi" as const,
    label: "KALSHI Michigan Senate",
    points: [
      { date: new Date("2024-06-01T00:00:00Z"), close: 40 },
      { date: new Date("2026-02-01T00:00:00Z"), close: 51 },
      { date: new Date("2027-01-01T00:00:00Z"), close: 90 },
    ],
  };

  test("house overlay is one pollster line plus the aligned PM series", () => {
    const series = buildPollAnalysisSeries({
      rows,
      poll,
      choice: "Slotkin",
      group: "house",
      view: "overlay",
      palette,
      market: marketOverlay,
    });
    expect(series[0]!.id).toBe("pollster:EPIC-MRA");
    expect(series[0]!.style).toBe("line");
    expect(series[0]!.points.map((point) => point.value)).toEqual([46, 49]);
    expect(series.some((entry) => entry.id.includes("Trafalgar"))).toBe(false);
    const pm = series.find((entry) => entry.id.startsWith("pm:"))!;
    expect(pm.id).toBe("pm:kalshi:KXMI-SEN-2026");
    expect(pm.points.map((point) => point.value)).toEqual([51]);
  });

  test("race overlay and scatter reuse CompositeChart styles with a PM line", () => {
    const overlay = buildPollAnalysisSeries({
      rows,
      poll,
      choice: "Slotkin",
      group: "race",
      view: "overlay",
      palette,
      market: marketOverlay,
    });
    const scatter = buildPollAnalysisSeries({
      rows,
      poll,
      choice: "Slotkin",
      group: "race",
      view: "scatter",
      palette,
      market: marketOverlay,
    });
    expect(overlay.map((entry) => entry.id)).toEqual([
      "pollster:EPIC-MRA",
      "pollster:Trafalgar",
      "pm:kalshi:KXMI-SEN-2026",
    ]);
    expect(overlay.filter((entry) => entry.id.startsWith("pollster:")).every((entry) => entry.style === "line")).toBe(true);
    expect(scatter.filter((entry) => entry.id.startsWith("pollster:")).every((entry) => entry.style === "points")).toBe(true);
    expect(scatter.at(-1)).toMatchObject({ id: "pm:kalshi:KXMI-SEN-2026", style: "line" });
  });

  test("clips a prediction series to the poll window so unrelated years drop out", () => {
    const window = pollSeriesTimeWindow([
      { date: "2026-01-10", value: 46, pollster: "EPIC-MRA" },
      { date: "2026-03-10", value: 49, pollster: "EPIC-MRA" },
    ]);
    const clipped = clipPricePointsToWindow(marketOverlay.points, window);
    expect(clipped.map((point) => point.close)).toEqual([51]);
  });
});
