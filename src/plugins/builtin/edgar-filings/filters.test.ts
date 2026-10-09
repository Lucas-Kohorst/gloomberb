import { describe, expect, test } from "bun:test";
import type { SecFilingItem } from "../../../types/data-provider";
import { feedForm, filterFilingRows, formChoices, issuerFilingRow, sortFilingRows } from "./filters";
import type { EdgarFiling } from "./types";

const filing = (form: string, role: string, company: string, accepted: string): EdgarFiling => ({
  id: `${form}:${company}:${role}`,
  accessionNumber: form,
  form,
  companyName: company,
  role,
  cik: "0000000001",
  acceptedAt: new Date(accepted),
  filedDate: "2026-10-07",
  items: [],
  filingUrl: "https://www.sec.gov/x",
});

describe("filing filters", () => {
  test("the feed asks for one form, and fund filings ask for the portfolio report", () => {
    expect(feedForm("8-k")).toBe("8-K");
    expect(feedForm("funds")).toBe("NPORT-P");
    expect(feedForm("")).toBe("");
  });

  test("a typed form joins the preset list", () => {
    expect(formChoices("6-K").at(-1)).toEqual({ value: "6-K", label: "6-K" });
    expect(formChoices("8-K")).toHaveLength(9);
  });

  test("form and role narrow the loaded rows", () => {
    const rows = [
      filing("8-K", "Filer", "Crane", "2026-10-07T12:00:00Z"),
      filing("8-K/A", "Filer", "Crane", "2026-10-07T13:00:00Z"),
      filing("10-Q", "Filer", "Crane", "2026-10-07T14:00:00Z"),
      filing("13F-HR", "Filer", "Fund", "2026-10-07T15:00:00Z"),
      filing("13F-HR/A", "Reporting", "Fund", "2026-10-07T16:00:00Z"),
      filing("4", "Reporting", "Officer", "2026-10-07T17:00:00Z"),
      filing("424B2", "Filer", "Issuer", "2026-10-07T18:00:00Z"),
      filing("N-CSR", "Filer", "Fund", "2026-10-07T19:00:00Z"),
      filing("NPORT-P", "Filer", "Fund", "2026-10-07T20:00:00Z"),
    ];
    expect(filterFilingRows(rows, "8-K", "").map((row) => row.form)).toEqual(["8-K", "8-K/A"]);
    expect(filterFilingRows(rows, "13F", "").map((row) => row.form)).toEqual(["13F-HR", "13F-HR/A"]);
    expect(filterFilingRows(rows, "4", "").map((row) => row.form)).toEqual(["4"]);
    expect(filterFilingRows(rows, "funds", "").map((row) => row.form)).toEqual(["N-CSR", "NPORT-P"]);
    expect(filterFilingRows(rows, "", "Reporting").map((row) => row.form)).toEqual(["13F-HR/A", "4"]);
  });

  test("company sort is alphabetical, newer first within a name", () => {
    const rows = [
      filing("8-K", "Filer", "Beta", "2026-10-07T12:00:00Z"),
      filing("8-K", "Filer", "Alpha", "2026-10-07T11:00:00Z"),
      filing("10-Q", "Filer", "Alpha", "2026-10-07T15:00:00Z"),
    ];
    expect(sortFilingRows(rows, "company").map((row) => `${row.companyName}:${row.form}`)).toEqual([
      "Alpha:10-Q",
      "Alpha:8-K",
      "Beta:8-K",
    ]);
    expect(sortFilingRows(rows, "accepted")).toBe(rows);
  });

  test("an issuer filing keeps the symbol when the filing names no company", () => {
    const item: SecFilingItem = {
      accessionNumber: "0001-26-000001",
      form: "NPORT-P",
      filingDate: new Date("2026-10-01T00:00:00Z"),
      cik: "123",
      filingUrl: "https://www.sec.gov/x",
    };
    expect(issuerFilingRow(item, "FLUT")).toMatchObject({
      companyName: "FLUT",
      role: "Issuer",
      cik: "0000000123",
      form: "NPORT-P",
      filedDate: "2026-10-01",
    });
  });
});
