import { describe, expect, test } from "bun:test";
import { extractArticleTickers } from "./article-tickers";

describe("extractArticleTickers", () => {
  test("trusts dollar, parenthetical, and exchange-qualified symbols", () => {
    expect(extractArticleTickers("Chip stocks ripped after $SMCI guided up.")).toEqual(["SMCI"]);
    expect(extractArticleTickers("Apple (AAPL) and Microsoft (MSFT) led the tape.")).toEqual(["AAPL", "MSFT"]);
    expect(extractArticleTickers("NASDAQ:ARM jumped on the print.")).toEqual(["ARM"]);
  });

  test("only matches bare mega-caps or symbols the user already tracks", () => {
    expect(extractArticleTickers("NVIDIA NVDA beat, while SMCI was unmentioned as a bare token.")).toEqual(["NVDA"]);
    expect(extractArticleTickers("SMCI rallied in after-hours.", { symbols: ["SMCI"] })).toEqual(["SMCI"]);
  });

  test("does not treat macro jargon as tickers", () => {
    expect(extractArticleTickers("The CEO said GDP and CPI prints hit the FED.")).toEqual([]);
  });

  test("maps tracked company names onto their symbols", () => {
    expect(extractArticleTickers("Apple reported iPhone sales above estimates.", {
      names: [{ symbol: "AAPL", name: "Apple Inc." }],
    })).toEqual(["AAPL"]);
    expect(extractArticleTickers("Super Micro guided higher.", {
      names: [{ symbol: "SMCI", name: "Super Micro Computer, Inc." }],
    })).toEqual(["SMCI"]);
  });
});
