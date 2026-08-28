import { describe, expect, test } from "bun:test";
import {
  weatherReportTimestamp,
  weatherSettlementStatusExplanation,
} from "./settlement-tab";

describe("weather settlement provenance", () => {
  test("explains authority print status instead of exposing only its enum", () => {
    expect(weatherSettlementStatusExplanation("official")).toBe(
      "official — final Weather Company CLI print",
    );
    expect(weatherSettlementStatusExplanation("preliminary")).toContain("may still be revised");
    expect(weatherSettlementStatusExplanation("pending")).toContain("not available");
    expect(weatherSettlementStatusExplanation("no_report")).toContain("no value");
    expect(weatherSettlementStatusExplanation("unknown")).toContain("unavailable");
    expect(weatherSettlementStatusExplanation(null)).toContain("unavailable");
  });

  test("keeps the source timestamp exact while adding local context", () => {
    expect(weatherReportTimestamp("2026-08-19T12:00:00Z", "America/Los_Angeles")).toContain(
      "2026-08-19T12:00:00Z UTC",
    );
    expect(weatherReportTimestamp("2026-08-19T12:00:00Z", "America/Los_Angeles")).toContain("local");
    expect(weatherReportTimestamp(null, "UTC")).toBeNull();
    expect(weatherReportTimestamp("not-a-date", "UTC")).toBe("not-a-date");
  });
});
