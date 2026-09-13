const PERIODIC_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A"]);

export const ETF_FILING_FORMS = [
  "N-1A",
  "N-1A/A",
  "485BPOS",
  "485APOS",
  "497",
  "497K",
  "N-CSR",
  "N-CSRS",
  "N-CEN",
  "NPORT-P",
  "NPORT-EX",
  "N-PORT",
  "24F-2NT",
  "N-2",
  "N-2/A",
] as const;

export const ETF_FORMS_SETTING = ETF_FILING_FORMS.join(",");

export function isEtfFilingForm(form: string): boolean {
  return (ETF_FILING_FORMS as readonly string[]).includes(normalizeFilingForm(form));
}

export function normalizeFilingForm(form: string): string {
  return form.trim().toUpperCase();
}

export function isPeriodicReportForm(form: string): boolean {
  return PERIODIC_FORMS.has(normalizeFilingForm(form));
}

export function parseFormsSetting(value: string | undefined): Set<string> | null {
  const parts = (value ?? "")
    .split(",")
    .map((part) => normalizeFilingForm(part))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return new Set(parts);
}

export function filingMatchesForms(
  form: string,
  forms: Set<string> | null,
): boolean {
  if (!forms) return true;
  return forms.has(normalizeFilingForm(form));
}
