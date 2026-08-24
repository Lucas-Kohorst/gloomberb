import { buildSections, type CommandBarSectionOrder } from "../view-model";

export interface ResultItem {
  id: string;
  label: string;
  detail: string;
  category: string;
  kind: "command" | "ticker" | "search" | "plugin" | "action" | "info";
  right?: string;
  shortcutQuery?: string;
  searchText?: string;
  /** Tints the trailing marker and the section heading with the AI accent. */
  accent?: boolean;
  /**
   * Set false for rows that answer nothing on their own — a placeholder, or an
   * offer the user never asked for. The list skips them when it picks the
   * selection for an untouched query, so plain Enter always runs a real match.
   */
  defaultSelectable?: boolean;
  pluginToggle?: () => void | Promise<void>;
  secondaryAction?: () => void | Promise<void>;
  checked?: boolean;
  current?: boolean;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

type ListScreenKind = "root" | "mode" | "picker" | "pane-settings";

export interface ListScreenState {
  kind: ListScreenKind;
  title: string;
  subtitle?: string;
  query: string;
  selectedIdx: number;
  hoveredIdx: number | null;
  results: ResultItem[];
  searching: boolean;
  emptyLabel: string;
  emptyDetail: string;
  footerLeft: string;
  footerRight: string;
  sectionOrder?: CommandBarSectionOrder;
}

export type CommandBarListRow =
  | { kind: "spacer"; id: string }
  | { kind: "heading"; id: string; label: string; accent?: boolean }
  | { kind: "item"; item: ResultItem; globalIdx: number }
  | { kind: "message"; id: string; label: string; dim?: boolean }
  | { kind: "spinner"; id: string; label: string }
  | { kind: "filler"; id: string };

export function orderListResults(
  results: ResultItem[],
  options?: { sectionOrder?: CommandBarSectionOrder },
): ResultItem[] {
  return buildSections(results, options).flatMap((section) => section.items);
}

function sectionHasTickerMatch(
  sections: Array<{ category: string; items: ResultItem[] }>,
): boolean {
  return sections.some((section) => {
    if (section.category.trim().toLowerCase() === "exact match") return true;
    return section.items.some((item) => item.kind === "ticker" || item.kind === "search");
  });
}

/** Skip the Ask AI heading when a ticker already answered a one-row assist section. */
export function shouldOmitAskAiHeading(
  section: { category: string; items: ResultItem[] },
  sections: Array<{ category: string; items: ResultItem[] }>,
): boolean {
  if (section.category.trim().toLowerCase() !== "ask ai") return false;
  return section.items.length <= 1 && sectionHasTickerMatch(sections);
}

export function buildListRows(listState: ListScreenState): CommandBarListRow[] {
  const rows: CommandBarListRow[] = [];
  const sections = buildSections(listState.results, { sectionOrder: listState.sectionOrder });
  let globalIdx = 0;
  sections.forEach((section, sectionIndex) => {
    const omitHeading = shouldOmitAskAiHeading(section, sections);
    if (sectionIndex > 0) {
      rows.push({ kind: "spacer", id: `spacer:${sectionIndex}:${section.category}` });
    }
    if (!omitHeading) {
      rows.push({
        kind: "heading",
        id: `heading:${sectionIndex}:${section.category}`,
        label: section.category,
        accent: section.items.some((item) => item.accent),
      });
    }
    for (const item of section.items) {
      rows.push({ kind: "item", item, globalIdx });
      globalIdx += 1;
    }
  });
  return rows;
}

export function buildNativeListRows(listState: ListScreenState, rows: CommandBarListRow[]): CommandBarListRow[] {
  if (listState.searching && rows.length === 0) {
    return [{ kind: "spinner", id: "searching", label: "Searching…" }];
  }
  if (rows.length === 0) {
    return [{ kind: "message", id: "empty", label: listState.emptyLabel }];
  }
  if (listState.searching) {
    return [...rows, { kind: "spinner", id: "searching", label: "Searching…" }];
  }
  return rows;
}
