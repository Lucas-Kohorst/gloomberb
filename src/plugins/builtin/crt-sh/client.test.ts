import { describe, expect, test } from "bun:test";
import { parseCertificateRecords } from "./client";

describe("crt.sh parse cap", () => {
  test("stops after the display cap instead of mapping every certificate", async () => {
    const payload = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      issuer_name: "CA",
      common_name: `n${index}.example.com`,
      name_value: `n${index}.example.com`,
      not_before: "2020-01-01T00:00:00Z",
      not_after: "2021-01-01T00:00:00Z",
      serial_number: String(index),
    }));
    let partialCount = 0;
    const parsed = await parseCertificateRecords(payload, {
      cap: 5,
      firstPaint: 2,
      yieldEvery: 1,
      onPartial: (records) => {
        partialCount = records.length;
      },
    });
    expect(partialCount).toBe(2);
    expect(parsed.records).toHaveLength(5);
    expect(parsed.total).toBe(20);
  });
});
