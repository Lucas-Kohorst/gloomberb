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

export function normalizeFilingForm(form: string): string {
  return form.trim().toUpperCase();
}

/** Empty means no form filter. The unfiltered SEC template relies on that. */
export function parseFormsSetting(value: string | undefined): string[] | null {
  const forms = (value ?? "")
    .split(",")
    .map((part) => normalizeFilingForm(part))
    .filter(Boolean);
  return forms.length > 0 ? forms : null;
}
