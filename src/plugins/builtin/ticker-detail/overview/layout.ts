export const OVERVIEW_PANEL_OPTIONS = [
  { value: "news", label: "News" },
  { value: "buzz", label: "Buzz" },
  { value: "sec", label: "Filings" },
  { value: "analyst-research", label: "Analyst" },
  { value: "snapshot", label: "Company snapshot and chart" },
] as const;

export type OverviewPanelId = typeof OVERVIEW_PANEL_OPTIONS[number]["value"];
export const OVERVIEW_PRESET_OPTIONS = [
  { value: "research", label: "Research" },
  { value: "news", label: "News and buzz" },
  { value: "filings", label: "Filings and analyst" },
  { value: "classic", label: "Quote overview" },
  { value: "custom", label: "Custom panels" },
] as const;
export type OverviewPreset = typeof OVERVIEW_PRESET_OPTIONS[number]["value"];

export function normalizeOverviewPreset(value: unknown): OverviewPreset {
  return OVERVIEW_PRESET_OPTIONS.some((option) => option.value === value) ? value as OverviewPreset : "classic";
}

export function normalizeOverviewPanel(value: unknown): OverviewPanelId | "none" {
  return OVERVIEW_PANEL_OPTIONS.some((option) => option.value === value) ? value as OverviewPanelId : "none";
}

export function overviewPanels(preset: OverviewPreset, custom: readonly unknown[]): OverviewPanelId[] {
  const values = preset === "classic" ? []
    : preset === "news" ? ["news", "buzz"]
      : preset === "filings" ? ["sec", "analyst-research"]
        : preset === "custom" ? custom
          : ["news", "buzz", "sec", "analyst-research"];
  return [...new Set(values.map(normalizeOverviewPanel).filter((value): value is OverviewPanelId => value !== "none"))];
}
