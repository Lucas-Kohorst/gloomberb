import { describe, expect, test } from "bun:test";
import { parseBankBoard } from "./client";

const fixture = {
  meta: {
    total: 4220,
    parameters: { filters: "ACTIVE:1", fields: "NAME,CERT,ASSET,DEP,STNAME,REPDTE", limit: "40" },
    index: { name: "institutions_20261009090008", createTimestamp: "2026-10-09T12:00:05Z" },
  },
  data: [
    {
      NAME: "not this",
      ASSET: 1,
      data: {
        REPDTE: "06/30/2026",
        STNAME: "Ohio",
        ASSET: 4091315000,
        CERT: 628,
        DEP: 2820284000,
        NAME: "JPMorgan Chase Bank, National Association",
        ID: "628",
      },
      score: 0,
    },
    {
      data: {
        REPDTE: "20260331",
        STNAME: "Utah",
        ASSET: 1500000,
        CERT: 1,
        DEP: 500000,
        NAME: "Example Bank",
      },
      score: 0,
    },
    { data: { STNAME: "Ohio", ASSET: 1 }, score: 0 },
    { score: 0 },
  ],
  totals: { count: 4220 },
};

describe("bank balance sheet parsing", () => {
  test("reads the nested data row, in billions, and keeps the latest report date", () => {
    const board = parseBankBoard(fixture);
    expect(board.banks).toHaveLength(2);
    expect(board.banks[0]).toMatchObject({
      id: "628",
      name: "JPMorgan Chase Bank, National Association",
      state: "Ohio",
      reportDate: "2026-06-30",
    });
    expect(board.banks[0]?.assets).toBeCloseTo(4091.315, 5);
    expect(board.banks[0]?.deposits).toBeCloseTo(2820.284, 5);
    expect(board.banks[1]).toMatchObject({
      id: "1",
      name: "Example Bank",
      state: "Utah",
      assets: 1.5,
      deposits: 0.5,
      reportDate: "2026-03-31",
    });
    expect(board.reportDate).toBe("2026-06-30");
  });

  test("an empty or shapeless payload is no banks and no report date", () => {
    expect(parseBankBoard(null)).toEqual({ banks: [], reportDate: null });
    expect(parseBankBoard({ meta: { total: 0 }, data: [] })).toEqual({ banks: [], reportDate: null });
    expect(parseBankBoard({ meta: { total: 1 } })).toEqual({ banks: [], reportDate: null });
  });
});
