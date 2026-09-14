import { expect, test } from "bun:test";
import { searchNotes, tokenizeNoteTickers } from "./model";

test("searches quick-note titles and all note bodies case-insensitively", () => {
  const matches = searchNotes([
    { key: "__note-1__", text: "Review $NVDA earnings", updatedAt: 2 },
    { key: "AAPL", text: "Supply-chain watch", updatedAt: 1 },
  ], [
    { id: "1", title: "Earnings calendar" },
  ], "earnings");

  expect(matches).toEqual([{
    key: "__note-1__",
    title: "Earnings calendar",
    text: "Review $NVDA earnings",
    updatedAt: 2,
    kind: "quick",
  }]);
});

test("tokenizes only bounded uppercase note ticker links", () => {
  expect(tokenizeNoteTickers("Watch $AAPL, $BRK:NYSE and $TSLA. $100 $TOOLONG $TSLA:")).toEqual([
    { kind: "text", value: "Watch " },
    { kind: "ticker", value: "$AAPL", symbol: "AAPL" },
    { kind: "text", value: ", " },
    { kind: "ticker", value: "$BRK:NYSE", symbol: "BRK:NYSE" },
    { kind: "text", value: " and " },
    { kind: "ticker", value: "$TSLA", symbol: "TSLA" },
    { kind: "text", value: ". $100 $TOOLONG $TSLA:" },
  ]);
});
