import { expect, test } from "bun:test";
import { movesSince, noteDeparture, returnMoves, takeReturn } from "./since-last-seen";

const AWAY_MS = 120_000;

test("only rows priced on both sides that moved at least 0.01% are recapped", () => {
  const moves = movesSince(
    new Map([["AAPL", 200], ["MSFT", 400], ["FLAT", 100], ["GONE", 50], ["ZERO", 0]]),
    new Map([["AAPL", 202], ["MSFT", 396], ["FLAT", 100.004], ["ZERO", 1], ["NEW", 10]]),
  );
  expect([...moves.keys()].sort()).toEqual(["AAPL", "MSFT"]);
  expect(moves.get("AAPL")).toBeCloseTo(1);
  expect(moves.get("MSFT")).toBeCloseTo(-1);
});

test("coming back recaps only after the away threshold, and a short glance resets the clock", () => {
  const before = new Map([["AAPL", 200]]);
  const after = new Map([["AAPL", 210]]);

  noteDeparture("pane", 0, before);
  expect(takeReturn("pane", AWAY_MS - 1, AWAY_MS)).toBeNull();
  // The glance used up the departure: a later return without a new one shows nothing.
  expect(takeReturn("pane", AWAY_MS * 2, AWAY_MS)).toBeNull();

  noteDeparture("pane", 0, before);
  const back = takeReturn("pane", AWAY_MS, AWAY_MS)!;
  expect(returnMoves(back, AWAY_MS, after)?.get("AAPL")).toBeCloseTo(5);
});

test("a pane remounted on stale prices still recaps the quotes that land just after, and keeps each row's first move", () => {
  noteDeparture("pane", 0, new Map([["AAPL", 200], ["BTC", 100]]));
  const back = takeReturn("pane", AWAY_MS, AWAY_MS)!;

  // Remounted from a hidden layout tab, it first draws what it had when it left.
  expect(returnMoves(back, AWAY_MS, new Map([["AAPL", 200], ["BTC", 100]]))).toBeNull();
  const first = returnMoves(back, AWAY_MS + 300, new Map([["AAPL", 202], ["BTC", 100]]))!;
  expect([...first.keys()]).toEqual(["AAPL"]);
  // A later tick adds the row that moved and does not flip the one already shown.
  const next = returnMoves(back, AWAY_MS + 900, new Map([["AAPL", 198], ["BTC", 101]]), first)!;
  expect(next.get("AAPL")).toBeCloseTo(1);
  expect(next.get("BTC")).toBeCloseTo(1);
  // Ticks after the first moments back are ones the user watched.
  expect(returnMoves(back, AWAY_MS + 60_000, new Map([["AAPL", 220], ["BTC", 90]]))).toBeNull();
});
