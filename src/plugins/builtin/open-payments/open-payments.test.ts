import { describe, expect, test } from "bun:test";
import {
  buildQueryUrl,
  isNpiQuery,
  isStateQuery,
  matchesQuery,
  parsePayment,
  parsePaymentsPayload,
} from "./client";
import { OPEN_PAYMENTS_GENERAL_PAYMENTS_DATASET_ID } from "./types";

// Row shape captured from the live DKAN datastore
// (2025 General Payment Data, api/1/datastore/query). Full rows carry ~90
// columns; the client selects only the fields below.
const LIVE_PHYSICIAN_ROW = {
  record_id: "1157125489",
  covered_recipient_first_name: "ROBERT",
  covered_recipient_middle_name: "",
  covered_recipient_last_name: "DURICK",
  covered_recipient_name_suffix: "",
  teaching_hospital_name: "",
  covered_recipient_npi: "1659344299",
  recipient_city: "YOUNGSTOWN",
  recipient_state: "OH",
  applicable_manufacturer_or_applicable_gpo_making_payment_name:
    "ESSENTIAL DENTAL SYSTEMS INCORPORATED",
  total_amount_of_payment_usdollars: "47.96",
  date_of_payment: "07/24/2025",
  nature_of_payment_or_transfer_of_value: "Gift",
  form_of_payment_or_transfer_of_value: "Cash or cash equivalent",
  name_of_drug_or_biological_or_device_or_medical_supply_1: "SafeSider HF",
  product_category_or_therapeutic_area_1: "DENTAL",
  program_year: "2025",
};

const LIVE_HOSPITAL_ROW = {
  record_id: "757101468",
  covered_recipient_first_name: "",
  covered_recipient_last_name: "",
  teaching_hospital_name: "Mayo Clinic",
  covered_recipient_npi: "",
  recipient_city: "ROCHESTER",
  recipient_state: "MN",
  applicable_manufacturer_or_applicable_gpo_making_payment_name: "Pfizer Inc.",
  total_amount_of_payment_usdollars: "2500",
  date_of_payment: "2025-01-15",
  nature_of_payment_or_transfer_of_value: "Consulting Fee",
  form_of_payment_or_transfer_of_value: "Cash or cash equivalent",
  name_of_drug_or_biological_or_device_or_medical_supply_1: "",
  product_category_or_therapeutic_area_1: "",
  program_year: "2025",
};

describe("parsePayment", () => {
  test("maps the live physician row into a titled, stable record", () => {
    const payment = parsePayment(LIVE_PHYSICIAN_ROW)!;
    expect(payment).toMatchObject({
      id: "1157125489",
      recipientName: "Robert Durick",
      recipientFirstName: "Robert",
      recipientLastName: "Durick",
      recipientCity: "Youngstown",
      recipientState: "OH",
      npi: "1659344299",
      companyName: "ESSENTIAL DENTAL SYSTEMS INCORPORATED",
      nature: "Gift",
      productName: "SafeSider HF",
      programYear: "2025",
    });
    expect(payment.amount).toBeCloseTo(47.96);
    expect(payment.date?.toISOString()).toContain("2025-07-24");
  });

  test("prefers the teaching hospital name when the recipient is a hospital", () => {
    const payment = parsePayment(LIVE_HOSPITAL_ROW)!;
    expect(payment.recipientName).toBe("Mayo Clinic");
    expect(payment.amount).toBe(2500);
  });

  test("drops rows without any recipient or company identity", () => {
    expect(parsePayment(null)).toBeNull();
    expect(parsePayment("nope")).toBeNull();
    expect(parsePayment({})).toBeNull();
    expect(parsePayment({ record_id: "1", total_amount_of_payment_usdollars: "5" })).toBeNull();
  });

  test("tolerates malformed amounts and dates instead of throwing", () => {
    const payment = parsePayment({
      ...LIVE_PHYSICIAN_ROW,
      total_amount_of_payment_usdollars: "not-a-number",
      date_of_payment: "not-a-date",
    })!;
    expect(payment.amount).toBeNull();
    expect(payment.date).toBeNull();
  });
});

describe("parsePaymentsPayload", () => {
  test("parses the DKAN envelope and keeps its count", () => {
    const page = parsePaymentsPayload({
      results: [LIVE_PHYSICIAN_ROW, LIVE_HOSPITAL_ROW],
      count: 16131856,
    });
    expect(page.total).toBe(16131856);
    expect(page.payments.map((payment) => payment.id)).toEqual(["1157125489", "757101468"]);
  });

  test("skips junk rows instead of failing the whole payload", () => {
    const page = parsePaymentsPayload({
      results: [LIVE_PHYSICIAN_ROW, null, {}, "junk"],
      count: 4,
    });
    expect(page.payments).toHaveLength(1);
    expect(page.total).toBe(4);
  });

  test("stops at the display cap", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      ...LIVE_PHYSICIAN_ROW,
      record_id: `row-${index}`,
    }));
    expect(parsePaymentsPayload({ results: rows, count: 10 }, 3).payments).toHaveLength(3);
  });

  test("returns an empty page for an unknown body", () => {
    expect(parsePaymentsPayload(null)).toEqual({ payments: [], total: null });
    expect(parsePaymentsPayload("<html>")).toEqual({ payments: [], total: null });
  });
});

describe("query routing", () => {
  test("NPI digits route to an indexed server-side equality", () => {
    expect(isNpiQuery("1659344299")).toBe(true);
    expect(isNpiQuery("123")).toBe(false);
    expect(isNpiQuery("Pfizer")).toBe(false);
    const params = new URL(buildQueryUrl("1659344299", 50)).searchParams;
    expect(params.get("conditions[0][property]")).toBe("covered_recipient_npi");
    expect(params.get("conditions[0][value]")).toBe("1659344299");
    expect(params.get("conditions[0][operator]")).toBe("=");
  });

  test("two-letter codes route to an indexed server-side state filter", () => {
    expect(isStateQuery("oh")).toBe(true);
    expect(isStateQuery("Ohio")).toBe(false);
    const params = new URL(buildQueryUrl("oh", 50)).searchParams;
    expect(params.get("conditions[0][property]")).toBe("recipient_state");
    expect(params.get("conditions[0][value]")).toBe("OH");
  });

  test("free text carries no server conditions and matches locally", () => {
    const params = new URL(buildQueryUrl("Pfizer", 50)).searchParams;
    expect(params.get("conditions[0][property]")).toBeNull();
    expect(params.get("limit")).toBe("50");
    expect(params.get("properties[0]")).toBe("record_id");
    const url = buildQueryUrl("Pfizer", 50);
    expect(url).toContain(OPEN_PAYMENTS_GENERAL_PAYMENTS_DATASET_ID);
    expect(url).toContain("openpaymentsdata.cms.gov");
  });

  test("matchesQuery finds companies, recipients, NPIs, and states", () => {
    const payment = parsePayment(LIVE_HOSPITAL_ROW)!;
    expect(matchesQuery(payment, "pfizer")).toBe(true);
    expect(matchesQuery(payment, "MAYO rochester")).toBe(true);
    expect(matchesQuery(payment, "mn")).toBe(true);
    expect(matchesQuery(payment, "consulting")).toBe(true);
    expect(matchesQuery(payment, "")).toBe(true);
    expect(matchesQuery(payment, "Novartis Zurich")).toBe(false);
  });

  test("matchesQuery finds physicians by name fragment", () => {
    const payment = parsePayment(LIVE_PHYSICIAN_ROW)!;
    expect(matchesQuery(payment, "durick")).toBe(true);
    expect(matchesQuery(payment, "1659344299")).toBe(true);
    expect(matchesQuery(payment, "dental")).toBe(true);
  });
});
