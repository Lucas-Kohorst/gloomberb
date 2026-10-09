import { describe, expect, test } from "bun:test";
import { corporateBondPayloadRows, parseCorporateBondTape } from "./client";

const realty = {
  cusip: "756109AG9",
  issueSymbolIdentifier: "O.GE",
  issuerName: "REALTY INCOME CORP",
  couponRate: 5.875,
  maturityDate: "2035-03-15",
  lastSalePrice: 98.736,
  lastSaleYield: 6.068017,
  priceChangeNumber: 0.12,
  lastTradeDate: "2026-10-09",
  traceGradeCode: "I",
};

const fraser = {
  cusip: "351258AB4",
  issuerName: "FRASER PAPERS INC",
  couponRate: "8.75",
  maturityDate: "2015-03-15",
  lastSalePrice: 10.5,
  lastSaleYield: null,
  priceChangeNumber: -0.25,
  lastTradeDate: "2026-10-08",
  traceGradeCode: "H",
};

describe("corporate bond tape parsing", () => {
  test("parses two bonds from the reporting envelope and orders them by last trade", () => {
    const payload = {
      status: "success",
      returnBody: { data: JSON.stringify([fraser, realty]) },
    };
    const bonds = parseCorporateBondTape(payload);
    expect(corporateBondPayloadRows(payload)).toHaveLength(2);
    expect(bonds.map((bond) => bond.id)).toEqual(["756109AG9", "351258AB4"]);
    expect(bonds[0]).toMatchObject({
      issuerName: "REALTY INCOME CORP",
      couponRate: 5.875,
      maturityDate: "2035-03-15",
      lastSalePrice: 98.736,
      lastSaleYield: 6.068017,
      priceChangeNumber: 0.12,
      lastTradeDate: "2026-10-09",
      traceGradeCode: "I",
    });
    expect(bonds[1]).toMatchObject({
      issuerName: "FRASER PAPERS INC",
      couponRate: 8.75,
      lastSaleYield: null,
      priceChangeNumber: -0.25,
      lastTradeDate: "2026-10-08",
      traceGradeCode: "H",
    });
  });

  test("keeps one page and drops the oldest sale past it", () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      cusip: String(index).padStart(3, "0"),
      issuerName: `Issuer ${index}`,
      lastTradeDate: index === 0 ? "2020-01-01" : "2026-10-09",
      couponRate: 5,
    }));
    const bonds = parseCorporateBondTape({ returnBody: { data: rows } });
    expect(bonds).toHaveLength(100);
    expect(bonds.some((bond) => bond.id === "000")).toBe(false);
    expect(bonds[0]?.lastTradeDate).toBe("2026-10-09");
  });
});
