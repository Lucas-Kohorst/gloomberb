import { describe, expect, test } from "bun:test";
import { matchesCountryEconSearch, parseWorldBankPayload } from "./normalize";

const SAMPLE = [
  { page: 1, pages: 1, per_page: 50, total: 3 },
  [
    {
      indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" },
      country: { id: "US", value: "United States" },
      countryiso3code: "USA",
      date: "2024",
      value: 29_000_000_000_000,
    },
    {
      indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" },
      country: { id: "1W", value: "World" },
      countryiso3code: "WLD",
      date: "2024",
      value: 110_000_000_000_000,
    },
    {
      indicator: { id: "NY.GDP.MKTP.CD", value: "GDP" },
      country: { id: "XX", value: "Missing" },
      countryiso3code: "XXX",
      date: "2024",
      value: null,
    },
  ],
];

describe("parseWorldBankPayload", () => {
  test("splits countries from regional aggregates and keeps nulls", () => {
    const rows = parseWorldBankPayload(SAMPLE, "current US$");
    expect(rows.map((row) => [row.iso3, row.kind, row.value])).toEqual([
      ["USA", "country", 29_000_000_000_000],
      ["WLD", "region", 110_000_000_000_000],
      ["XXX", "country", null],
    ]);
  });

  test("rejects a malformed envelope", () => {
    expect(parseWorldBankPayload({ error: true }, "%")).toEqual([]);
    expect(parseWorldBankPayload([], "%")).toEqual([]);
  });

  test("search matches iso, name, and kind", () => {
    const rows = parseWorldBankPayload(SAMPLE, "current US$");
    expect(rows.filter((row) => matchesCountryEconSearch(row, "world")).map((row) => row.iso3))
      .toEqual(["WLD"]);
    expect(rows.filter((row) => matchesCountryEconSearch(row, "region")).map((row) => row.iso3))
      .toEqual(["WLD"]);
  });
});
