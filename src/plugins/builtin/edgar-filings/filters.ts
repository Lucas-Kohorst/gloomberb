import type { SecFilingItem } from "../../../types/data-provider";
import { ETF_FILING_FORMS } from "../sec/forms";
import type { EdgarFiling } from "./types";

/** Issuer history filtered to registered-fund forms. The tape itself can only ask for one form. */
export const FUND_FORMS = "funds";

export const FORM_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "8-K", label: "8-K" },
  { value: "10-K", label: "10-K" },
  { value: "10-Q", label: "10-Q" },
  { value: "4", label: "Form 4" },
  { value: "13F", label: "13F" },
  { value: FUND_FORMS, label: "Funds" },
  { value: "S-1", label: "S-1" },
  { value: "DEF 14A", label: "Proxy" },
];

export const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "Filer", label: "Filer" },
  { value: "Issuer", label: "Issuer" },
  { value: "Reporting", label: "Reporting" },
  { value: "Subject", label: "Subject" },
  { value: "Filed by", label: "Filed by" },
];

export type FilingSort = "accepted" | "company";

export function normalizeFilingForm(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === FUND_FORMS) return FUND_FORMS;
  return trimmed.toUpperCase();
}

/** One `type` for the current-filings feed. Fund filings narrow to the monthly portfolio report. */
export function feedForm(form: string): string {
  return normalizeFilingForm(form) === FUND_FORMS ? "NPORT-P" : normalizeFilingForm(form);
}

export function formLabel(form: string): string {
  const normalized = normalizeFilingForm(form);
  return FORM_PRESETS.find((option) => option.value === normalized)?.label ?? normalized;
}

/** The preset list, plus the typed form when it is not one of them. */
export function formChoices(form: string): { value: string; label: string }[] {
  const normalized = normalizeFilingForm(form);
  if (FORM_PRESETS.some((option) => option.value === normalized)) return FORM_PRESETS;
  return [...FORM_PRESETS, { value: normalized, label: normalized }];
}

function matchesOne(form: string, accepted: string): boolean {
  if (form === accepted || form === `${accepted}/A`) return true;
  // 13F-HR, 13F-NT and their amendments share the 13F prefix. "4" does not.
  return accepted === "13F" && (form.startsWith("13F-") || form.startsWith("13F/"));
}

function matchesForm(form: string, selected: string): boolean {
  const normalized = normalizeFilingForm(selected);
  if (!normalized) return true;
  const accepted = normalized === FUND_FORMS ? ETF_FILING_FORMS : [normalized];
  const value = form.trim().toUpperCase();
  return accepted.some((item) => matchesOne(value, item));
}

export function filterFilingRows(rows: readonly EdgarFiling[], form: string, role: string): EdgarFiling[] {
  const wantedRole = role.trim().toLowerCase();
  return rows.filter((row) => {
    if (wantedRole && row.role.toLowerCase() !== wantedRole) return false;
    return matchesForm(row.form, form);
  });
}

/** Company order. Equal names keep the newer acceptance first. Newest keeps the feed order. */
export function sortFilingRows(rows: readonly EdgarFiling[], sort: FilingSort): EdgarFiling[] {
  if (sort !== "company") return rows as EdgarFiling[];
  return rows.toSorted((a, b) => a.companyName.localeCompare(b.companyName) || b.acceptedAt.getTime() - a.acceptedAt.getTime());
}

function padCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0");
}

/** One issuer filing, in the same row shape as the current-filings feed. */
export function issuerFilingRow(item: SecFilingItem, symbol: string): EdgarFiling {
  const cik = padCik(item.cik);
  const acceptedAt = item.acceptedAt ?? item.filingDate;
  const filed = Number.isNaN(item.filingDate.getTime()) ? "" : item.filingDate.toISOString().slice(0, 10);
  return {
    id: `${item.accessionNumber}:${cik}:Issuer`,
    accessionNumber: item.accessionNumber,
    form: item.form,
    companyName: item.companyName?.trim() || symbol,
    role: "Issuer",
    cik,
    acceptedAt,
    filedDate: filed,
    items: item.items ? [item.items] : [],
    filingUrl: item.filingUrl,
  };
}
