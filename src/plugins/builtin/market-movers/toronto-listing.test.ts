import { expect, test } from "bun:test";
import { publicTickerKey } from "../../../utils/exchanges";
import { torontoListingQuote } from "./model";

test("a Toronto listing keeps its last price on the TSX row", () => {
  const quote = torontoListingQuote({
    symbol: "T",
    name: "TELUS Corporation",
    last: 11.03,
    change: -0.4,
    changePercent: -3.5,
    volume: 10186263,
  });
  expect(quote).toMatchObject({
    symbol: "T",
    name: "TELUS Corporation",
    price: 11.03,
    change: -0.4,
    changePercent: -3.5,
    volume: 10186263,
    exchange: "TSX",
    currency: "",
    avgVolume: null,
    volumeRatio: null,
  });
  expect(publicTickerKey(quote.symbol, quote.exchange)).toBe("T:XTSE");
});
