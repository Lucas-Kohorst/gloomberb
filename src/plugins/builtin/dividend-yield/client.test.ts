import { describe, expect, test } from "bun:test";
import { extractDividendFields } from "./client";

describe("extractDividendFields", () => {
  test("reads dividend modules from quoteSummary.result[0], not the response root", () => {
    const fields = extractDividendFields({
      summaryDetail: {
        trailingAnnualDividendRate: { raw: 99 },
        trailingAnnualDividendYield: { raw: 0.99 },
        currency: "EUR",
      },
      quoteSummary: {
        result: [{
          summaryDetail: {
            trailingAnnualDividendRate: { raw: 1.02 },
            trailingAnnualDividendYield: { raw: 0.0045 },
            forwardAnnualDividendRate: { raw: 1.04 },
            dividendRate: { raw: 9.99 },
            payoutRatio: { raw: 0.99 },
            exDividendDate: { raw: 1719792000 },
            dividendDate: { raw: 1720396800 },
            currency: "USD",
          },
          financialData: {
            payoutRatio: { raw: 0.14 },
          },
        }],
      },
    });

    expect(fields).toEqual({
      trailingAnnualDividendRate: 1.02,
      trailingAnnualDividendYield: 0.0045,
      forwardAnnualDividendRate: 1.04,
      payoutRatio: 0.14,
      exDividendDate: 1719792000,
      dividendDate: 1720396800,
      currency: "USD",
    });
  });

  test("falls back to Yahoo's current summaryDetail field names", () => {
    const fields = extractDividendFields({
      quoteSummary: {
        result: [{
          summaryDetail: {
            dividendRate: { raw: 1.08 },
            payoutRatio: { raw: 0.1204 },
            currency: "USD",
          },
        }],
      },
    });

    expect(fields.forwardAnnualDividendRate).toBe(1.08);
    expect(fields.payoutRatio).toBe(0.1204);
  });
});
