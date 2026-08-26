import { describe, expect, test } from "bun:test";
import {
  ARRIVAL_HIGHLIGHT_MS,
  ARRIVAL_STAGGER_MS,
  MAX_TRACKED_SEEN_IDS,
  activeArrivalIds,
  createArrivalTracker,
  nextArrivalEventAt,
  observeItemIds,
} from "./recently-arrived";

describe("observeItemIds", () => {
  test("primes without marking the first batch as arriving", () => {
    const tracker = observeItemIds(createArrivalTracker(), ["a", "b", "c"], 1_000);
    expect(tracker.primed).toBe(true);
    expect(tracker.seenIds).toEqual(["a", "b", "c"]);
    expect(tracker.arrivals).toEqual([]);
    expect(activeArrivalIds(tracker, 1_000).size).toBe(0);
  });

  test("stays unprimed while the list is empty so hydrate does not cascade", () => {
    let tracker = observeItemIds(createArrivalTracker(), [], 1_000);
    expect(tracker.primed).toBe(false);

    tracker = observeItemIds(tracker, ["a", "b"], 2_000);
    expect(tracker.primed).toBe(true);
    expect(tracker.arrivals).toEqual([]);
    expect(activeArrivalIds(tracker, 2_000).size).toBe(0);
  });

  test("marks only unseen ids as arriving on later observations", () => {
    let tracker = observeItemIds(createArrivalTracker(), ["a", "b"], 1_000);
    tracker = observeItemIds(tracker, ["c", "a", "b", "d"], 2_000);

    expect(tracker.seenIds.slice(0, 4)).toEqual(["c", "a", "b", "d"]);
    expect(tracker.arrivals).toEqual([
      {
        id: "c",
        revealAt: 2_000,
        expiresAt: 2_000 + ARRIVAL_HIGHLIGHT_MS,
      },
      {
        id: "d",
        revealAt: 2_000 + ARRIVAL_STAGGER_MS,
        expiresAt: 2_000 + ARRIVAL_STAGGER_MS + ARRIVAL_HIGHLIGHT_MS,
      },
    ]);

    expect([...activeArrivalIds(tracker, 2_000)]).toEqual(["c"]);
    expect([...activeArrivalIds(tracker, 2_000 + ARRIVAL_STAGGER_MS)].sort()).toEqual([
      "c",
      "d",
    ]);
  });

  test("does not re-animate ids that leave and re-enter the list", () => {
    let tracker = observeItemIds(createArrivalTracker(), ["a", "b", "c"], 1_000);
    tracker = observeItemIds(tracker, ["a"], 2_000);
    tracker = observeItemIds(tracker, ["a", "b", "c"], 3_000);

    expect(tracker.arrivals).toEqual([]);
    expect(activeArrivalIds(tracker, 3_000).size).toBe(0);
  });

  test("caps observation so a huge id list does not walk as seen", () => {
    const ids = Array.from({ length: MAX_TRACKED_SEEN_IDS + 500 }, (_, index) => `id-${index}`);
    const tracker = observeItemIds(createArrivalTracker(), ids, 1_000);
    expect(tracker.seenIds).toHaveLength(MAX_TRACKED_SEEN_IDS);
    expect(tracker.seenIds[0]).toBe("id-0");
    expect(tracker.seenIds.at(-1)).toBe(`id-${MAX_TRACKED_SEEN_IDS - 1}`);
  });

  test("expires arrivals and reports the next timer boundary", () => {
    let tracker = observeItemIds(createArrivalTracker(), ["a"], 1_000);
    tracker = observeItemIds(tracker, ["a", "b"], 2_000);

    expect(nextArrivalEventAt(tracker, 2_000)).toBe(2_000 + ARRIVAL_HIGHLIGHT_MS);

    const afterExpiry = 2_000 + ARRIVAL_HIGHLIGHT_MS + 1;
    tracker = observeItemIds(tracker, ["a", "b"], afterExpiry);
    expect(tracker.arrivals).toEqual([]);
    expect(nextArrivalEventAt(tracker, afterExpiry)).toBeNull();
  });
});
