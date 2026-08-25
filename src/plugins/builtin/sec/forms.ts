const PERIODIC_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A"]);

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
