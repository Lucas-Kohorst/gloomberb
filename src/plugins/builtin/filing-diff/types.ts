export const FILING_DIFF_PLUGIN_ID = "filing-diff";
export const FILING_DIFF_PANE_ID = "filing-diff";
export const FILING_DIFF_TEMPLATE_ID = "filing-diff-pane";
export const FILING_DIFF_CONNECTION_ID = "filing-diff";

export type FilingDiffSectionId = "risk-factors" | "mda" | "full";

export const FILING_DIFF_SECTIONS: ReadonlyArray<{
  value: FilingDiffSectionId;
  label: string;
}> = [
  { value: "risk-factors", label: "Risk Factors (Item 1A)" },
  { value: "mda", label: "MD&A (Item 7)" },
  { value: "full", label: "Full filing" },
];

export const DEFAULT_FILING_DIFF_SECTION: FilingDiffSectionId = "risk-factors";

export function filingDiffSectionLabel(section: string): string {
  return FILING_DIFF_SECTIONS.find((entry) => entry.value === section)?.label
    ?? "Risk Factors (Item 1A)";
}

export function normalizeFilingDiffSection(value: unknown): FilingDiffSectionId {
  return value === "mda" || value === "full" ? value : "risk-factors";
}

export type DiffLineType = "added" | "removed" | "unchanged";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface FilingDiffResult {
  ticker: string;
  section: FilingDiffSectionId;
  baseLabel: string;
  compareLabel: string;
  baseAccession?: string;
  compareAccession?: string;
  baseUrl: string | null;
  compareUrl: string | null;
  lines: DiffLine[];
}
