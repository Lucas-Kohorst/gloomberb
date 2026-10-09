import { describe, expect, test } from "bun:test";
import { parseDebtToPenny, parseOperatingCash } from "./client";
import { formatBillions, formatTrillions } from "./model";

const cashFixture = {
  data: [
    {
      record_date: "2026-10-06",
      account_type: "Older day",
      open_today_bal: "1",
      close_today_bal: "2",
      src_line_nbr: "1",
    },
    {
      record_date: "not-a-date",
      account_type: "Skipped",
      open_today_bal: "9",
      close_today_bal: "9",
    },
    {
      record_date: "2026-10-07",
      account_type: "Treasury General Account (TGA) Opening Balance",
      open_today_bal: "885414",
      close_today_bal: "null",
      src_line_nbr: "1",
    },
    {
      record_date: "2026-10-07",
      account_type: "Treasury General Account (TGA) Closing Balance",
      open_today_bal: "885783",
      close_today_bal: "null",
      src_line_nbr: "4",
    },
  ],
};

describe("treasury daily parsing", () => {
  test("keeps the latest cash day and treats the string null as missing", () => {
    const cash = parseOperatingCash(cashFixture);
    expect(cash.recordDate).toBe("2026-10-07");
    expect(cash.rows).toEqual([
      {
        id: "2026-10-07:1",
        account: "Treasury General Account (TGA) Opening Balance",
        opening: 885414,
        closing: null,
      },
      {
        id: "2026-10-07:4",
        account: "Treasury General Account (TGA) Closing Balance",
        opening: 885783,
        closing: null,
      },
    ]);
    expect(formatBillions(cash.rows[0]?.opening)).toBe("885.41");
    expect(formatBillions(cash.rows[0]?.closing)).toBe("--");
    expect(formatBillions(0)).toBe("0.00");
  });

  test("parses debt in dollars, drops weekends, and keeps the newest 20 business days", () => {
    const dates: string[] = [];
    const cursor = new Date("2026-10-07T00:00:00Z");
    while (dates.length < 21) {
      const iso = cursor.toISOString().slice(0, 10);
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) dates.push(iso);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const debt = parseDebtToPenny({
      data: [
        {
          record_date: "2026-10-07",
          debt_held_public_amt: "32439260138550.17",
          intragov_hold_amt: "7844776008817.02",
          tot_pub_debt_out_amt: "40284036147367.19",
        },
        {
          record_date: "2026-10-04",
          debt_held_public_amt: "9",
          intragov_hold_amt: "9",
          tot_pub_debt_out_amt: "null",
        },
        ...dates.slice(1).map((date) => ({
          record_date: date,
          debt_held_public_amt: "1000000000000",
          intragov_hold_amt: "2000000000000",
          tot_pub_debt_out_amt: "3000000000000",
        })),
      ],
    });
    expect(debt).toHaveLength(20);
    expect(debt.map((row) => row.date)).toEqual(dates.slice(0, 20));
    expect(debt[0]).toMatchObject({
      heldByPublic: 32439260138550.17,
      intragovernmental: 7844776008817.02,
      total: 40284036147367.19,
    });
    expect(formatTrillions(debt[0]?.total)).toBe("40.28");
    expect(formatTrillions(debt[0]?.heldByPublic)).toBe("32.44");
    expect(debt.some((row) => row.date === "2026-10-04")).toBe(false);
    expect(parseDebtToPenny({ data: [] })).toEqual([]);
  });

  test("rejects a payload that is not the feed", () => {
    expect(() => parseOperatingCash({ meta: {} })).toThrow("Treasury response was not recognized");
    expect(() => parseDebtToPenny(null)).toThrow("Treasury response was not recognized");
    expect(parseOperatingCash({ data: [] })).toEqual({ recordDate: null, rows: [] });
  });
});
