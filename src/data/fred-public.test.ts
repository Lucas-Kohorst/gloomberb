import { describe, expect, test } from "bun:test";
import { parseFredGraphCsv } from "./fred-public";

describe("parseFredGraphCsv", () => {
  test("reads observation dates and treats dots as missing prints", () => {
    const rows = parseFredGraphCsv(
      "observation_date,BAMLC0A2CAAEY\n2026-08-17,5.33\n2026-08-18,.\n2026-08-19,5.19\n",
      "BAMLC0A2CAAEY",
    );
    expect(rows).toEqual([
      { date: "2026-08-17", value: 5.33 },
      { date: "2026-08-18", value: null },
      { date: "2026-08-19", value: 5.19 },
    ]);
  });

  test("rejects HTML error pages from unknown series ids", () => {
    expect(() => parseFredGraphCsv("<!DOCTYPE html><html>", "BAMLC0A2A")).toThrow("unavailable");
  });
});
