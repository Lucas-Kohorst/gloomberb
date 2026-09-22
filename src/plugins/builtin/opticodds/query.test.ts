import { describe, expect, test } from "bun:test";
import {
  fixtureSearchParams,
  oddsSearchParams,
  resolveOddsScope,
  scopeHasRequiredFilter,
} from "./query";

describe("resolveOddsScope", () => {
  test("opens on NFL when the search box is empty", () => {
    expect(resolveOddsScope("")).toEqual({ sport: "football", league: "nfl" });
    expect(resolveOddsScope("   ")).toEqual({ sport: "football", league: "nfl" });
  });

  test("keeps a team word on the default league instead of a filter-less request", () => {
    const scope = resolveOddsScope("team");
    expect(scope).toEqual({ sport: "football", league: "nfl", text: "team" });
    expect(scopeHasRequiredFilter(scope)).toBe(true);
    const params = fixtureSearchParams(scope);
    expect(params.get("sport")).toBe("football");
    expect(params.get("league")).toBe("nfl");
    expect(params.get("fixture_id")).toBeNull();
    expect(params.toString()).not.toContain("team");
  });

  test("maps league and sport names onto sport and league", () => {
    expect(resolveOddsScope("nba")).toEqual({ sport: "basketball", league: "nba" });
    expect(resolveOddsScope("Premier League")).toEqual({
      sport: "soccer",
      league: "england_-_premier_league",
    });
    expect(resolveOddsScope("basketball")).toEqual({ sport: "basketball", league: "nba" });
  });

  test("maps a fixture id onto fixture_id", () => {
    const scope = resolveOddsScope("202609250580A50A");
    expect(scope).toEqual({ fixtureId: "202609250580A50A" });
    expect(fixtureSearchParams(scope).getAll("id")).toEqual(["202609250580A50A"]);
    expect(oddsSearchParams([scope.fixtureId!]).getAll("fixture_id")).toEqual(["202609250580A50A"]);
  });

  test("refuses an odds request with no fixture", () => {
    expect(() => oddsSearchParams(["", "  "])).toThrow(/fixture_id/);
  });
});
