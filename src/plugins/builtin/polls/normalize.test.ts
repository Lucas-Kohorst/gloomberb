import { describe, expect, test } from "bun:test";
import { parseVoteHubPollsPayload } from "./client";
import {
  normalizeVoteHubPoll,
  parseSampleSize,
  populationLabel,
  summarizeAnswers,
} from "./normalize";

describe("VoteHub normalize", () => {
  test("accepts a bare poll array or a { polls } envelope", () => {
    const poll = {
      id: "p1",
      pollster: "Ipsos",
      subject: "Donald Trump",
      poll_type: "approval",
      answers: [],
    };
    expect(parseVoteHubPollsPayload([poll])).toHaveLength(1);
    expect(parseVoteHubPollsPayload({ polls: [poll] })).toHaveLength(1);
    expect(parseVoteHubPollsPayload({ data: [poll] })).toHaveLength(0);
  });

  test("summarizes a two-way result and lead", () => {
    const summary = summarizeAnswers([
      { choice: "Disapprove", pct: 51 },
      { choice: "Approve", pct: 44 },
    ]);
    expect(summary.leadChoice).toBe("Disapprove");
    expect(summary.lead).toBeCloseTo(7);
    expect(summary.result).toContain("Disapprove");
    expect(summary.result).toContain("Approve");
  });

  test("maps wire fields onto list rows", () => {
    const row = normalizeVoteHubPoll({
      id: "app1",
      poll_type: "generic-ballot",
      sample_size: "1,500",
      population: "lv",
      url: "https://example.com",
      created_at: "2026-08-01",
      start_date: "2026-07-28",
      end_date: "2026-07-30",
      pollster: "Emerson College",
      answers: [
        { choice: "Dem", pct: 44.4 },
        { choice: "Rep", pct: 48.4 },
      ],
      seat_name: "Generic",
      sponsors: ["Reuters"],
      internal: false,
      partisan: null,
      subject: "2026",
    });
    expect(row.pollTypeLabel).toBe("Generic");
    expect(row.population).toBe("LV");
    expect(row.sampleSize).toBe(1500);
    expect(row.leadChoice).toBe("Rep");
    expect(row.lead).toBeCloseTo(4);
    expect(parseSampleSize("800")).toBe(800);
    expect(populationLabel("rv")).toBe("RV");
  });
});
