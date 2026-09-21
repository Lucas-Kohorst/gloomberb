import { describe, expect, test } from "bun:test";
import { filterAdjacentRows, matchesAdjacentSearchHaystack, scoreAdjacentAndMatch } from "./search";

describe("adjacent AND search", () => {
  test("buffalo bills matches BUFNTI haystack that includes the Bills nickname", () => {
    const hay = "BUFNTI NFL Team Index: Buffalo buf_nti bills";
    expect(matchesAdjacentSearchHaystack(hay, "buffalo bills")).toBe(true);
    expect(scoreAdjacentAndMatch("buffalo bills", hay)).toBeGreaterThan(0);
  });

  test("houston bills matches neither city index", () => {
    expect(matchesAdjacentSearchHaystack("HOUNTI NFL Team Index: Houston", "houston bills")).toBe(false);
    expect(matchesAdjacentSearchHaystack("BUFNTI NFL Team Index: Buffalo bills", "houston bills")).toBe(false);
  });

  test("single token houston still matches Houston", () => {
    expect(matchesAdjacentSearchHaystack("HOUNTI NFL Team Index: Houston", "houston")).toBe(true);
  });

  test("leading slash from pane search is ignored", () => {
    expect(matchesAdjacentSearchHaystack("RED Index red", "/red")).toBe(true);
  });

  test("filters rows that miss a token", () => {
    const rows = filterAdjacentRows(
      [
        { ticker: "HOUNTI", name: "NFL Team Index: Houston" },
        { ticker: "BUFNTI", name: "NFL Team Index: Buffalo bills" },
      ],
      "buffalo bills",
      (row) => `${row.ticker} ${row.name}`,
    );
    expect(rows.map((row) => row.ticker)).toEqual(["BUFNTI"]);
  });

  test("market rows require every token", () => {
    const rows = filterAdjacentRows(
      [
        { title: "Fed decision", platform: "kalshi" },
        { title: "Fed cuts rates", platform: "polymarket" },
      ],
      "fed poly",
      (row) => `${row.title} ${row.platform}`,
    );
    expect(rows.map((row) => row.title)).toEqual(["Fed cuts rates"]);
  });
});
