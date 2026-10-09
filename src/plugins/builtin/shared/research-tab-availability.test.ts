import { describe, expect, test } from "bun:test";
import { ApiRequestError } from "../../../api-client/errors";
import type { QueryEntry } from "../../../market-data/result-types";
import { entryShows, shownIf } from "./research-tab-availability";

describe("shownIf", () => {
  test("hides an empty payload and a missing dataset", async () => {
    expect(await shownIf(async () => [], (rows) => rows.length > 0)).toBe(false);
    expect(await shownIf(async () => {
      throw new ApiRequestError("missing", 404);
    }, () => true)).toBe(false);
  });

  test("keeps the tab when the account is the problem or the request failed", async () => {
    expect(await shownIf(async () => {
      throw new ApiRequestError("sign in", 401);
    }, () => true)).toBe(true);
    expect(await shownIf(async () => {
      throw new ApiRequestError("upgrade", 402);
    }, () => true)).toBe(true);
    expect(await shownIf(async () => {
      throw new Error("network");
    }, () => true)).toBe(true);
  });
});

describe("entryShows", () => {
  const entry = (patch: Partial<QueryEntry<string[]>>): QueryEntry<string[]> => ({
    phase: "ready",
    data: null,
    lastGoodData: null,
    source: null,
    fetchedAt: null,
    staleAt: null,
    error: null,
    attempts: [],
    ...patch,
  });

  test("hides an empty coordinator result and keeps a retryable failure", () => {
    expect(entryShows(entry({ data: [], error: { reasonCode: "NO_DATA", message: "none" } }), (rows) => rows.length > 0)).toBe(false);
    expect(entryShows(entry({ error: { reasonCode: "TIMEOUT", message: "slow" } }), (rows) => rows.length > 0)).toBe(true);
    expect(entryShows(entry({ data: ["4"] }), (rows) => rows.length > 0)).toBe(true);
  });
});


