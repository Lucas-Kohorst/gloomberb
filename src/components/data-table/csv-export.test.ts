import { afterEach, describe, expect, test } from "bun:test";
import {
  csvEscape,
  csvFileName,
  getActivePaneCsvSnapshot,
  publishPaneCsvSnapshot,
  resetPaneCsvSnapshots,
  serializePaneCsv,
} from "./csv-export";

afterEach(() => {
  resetPaneCsvSnapshots();
});

describe("pane CSV export", () => {
  test("quotes commas, quotes, and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  test("serializes the focused table including a header row", () => {
    publishPaneCsvSnapshot({
      paneId: "polls:main",
      title: "Polls",
      focused: true,
      columns: ["Race", "Note"],
      rows: () => [["MI-SEN", 'Toss-up, "lean R"']],
    });
    expect(serializePaneCsv(getActivePaneCsvSnapshot()!)).toBe(
      'Race,Note\nMI-SEN,"Toss-up, ""lean R"""\n',
    );
  });

  test("keeps the last focused snapshot after the pane blurs", () => {
    publishPaneCsvSnapshot({
      paneId: "pm:main",
      title: "Prediction Markets",
      focused: true,
      columns: ["Market"],
      rows: () => [["Fed"]],
    });
    publishPaneCsvSnapshot({
      paneId: "pm:main",
      title: "Prediction Markets",
      focused: false,
      columns: ["Market"],
      rows: () => [["CPI"]],
    });
    expect(getActivePaneCsvSnapshot()?.title).toBe("Prediction Markets");
    expect(getActivePaneCsvSnapshot()?.rows()).toEqual([["CPI"]]);
  });

  test("builds a filesystem-safe csv name", () => {
    expect(csvFileName("Polls / VoteHub", new Date("2026-08-25T13:00:00Z"))).toBe(
      "polls-votehub-2026-08-25T13-00-00.csv",
    );
  });
});
