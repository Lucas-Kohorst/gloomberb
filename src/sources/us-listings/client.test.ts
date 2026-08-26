import { afterEach, describe, expect, test } from "bun:test";
import { SHARE_HOSTED_ORIGIN } from "../../shares/routes";
import {
  resetUsListingsClient,
  searchUsListedUniverse,
  setUsListingsUniverseForTests,
  usListingsUniverseUrl,
} from "./client";
import type { UsListingsUniverse } from "./types";

describe("us listings client", () => {
  afterEach(() => {
    resetUsListingsClient();
  });

  test("hosted clients hydrate same-origin keyed-data, not Yahoo", () => {
    (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
    expect(usListingsUniverseUrl()).toBe("/api/data/us-listings/universe");
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("desktop/TUI hydrates from keyed-data origin, not Nasdaq scrape", () => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
    expect(usListingsUniverseUrl()).toBe(`${SHARE_HOSTED_ORIGIN}/api/data/us-listings/universe`);
  });

  test("search peeks the cached universe instead of blocking on a fetch", async () => {
    const universe: UsListingsUniverse = {
      asOf: "2026-01-01T00:00:00.000Z",
      ttlSeconds: 60,
      sources: [],
      securities: [{
        symbol: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        type: "EQUITY",
        source: "nasdaqlisted",
      }],
    };
    setUsListingsUniverseForTests(universe);
    expect(await searchUsListedUniverse("AAPL")).toEqual([expect.objectContaining({
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
    })]);
    resetUsListingsClient();
    expect(await searchUsListedUniverse("AAPL")).toEqual([]);
  });
});
