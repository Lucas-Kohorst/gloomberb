import { expect, test } from "bun:test";
import {
  EMPTY_TICKER_HISTORY,
  moveTickerHistory,
  pushTickerHistory,
  TICKER_HISTORY_LIMIT,
  tickerHistorySymbol,
} from "./ticker-history";

test("ticker history navigates back and forward", () => {
  const history = ["AAPL", "MSFT", "NVDA"].reduce(pushTickerHistory, EMPTY_TICKER_HISTORY);
  const back = moveTickerHistory(history, -1);

  expect(tickerHistorySymbol(back)).toBe("MSFT");
  expect(tickerHistorySymbol(moveTickerHistory(back, 1))).toBe("NVDA");
});

test("a new ticker clears ticker history forward entries", () => {
  const history = ["AAPL", "MSFT", "NVDA"].reduce(pushTickerHistory, EMPTY_TICKER_HISTORY);
  const next = pushTickerHistory(moveTickerHistory(history, -1), "GOOG");

  expect(next).toEqual({ entries: ["AAPL", "MSFT", "GOOG"], index: 2 });
});

test("ticker history ignores consecutive duplicates and caps its depth", () => {
  const duplicate = pushTickerHistory(pushTickerHistory(EMPTY_TICKER_HISTORY, "AAPL"), "AAPL");
  const history = Array.from({ length: TICKER_HISTORY_LIMIT + 2 }, (_, index) => `T${index}`)
    .reduce(pushTickerHistory, EMPTY_TICKER_HISTORY);

  expect(duplicate).toEqual({ entries: ["AAPL"], index: 0 });
  expect(history.entries).toHaveLength(TICKER_HISTORY_LIMIT);
  expect(history.entries[0]).toBe("T2");
  expect(tickerHistorySymbol(history)).toBe(`T${TICKER_HISTORY_LIMIT + 1}`);
});
