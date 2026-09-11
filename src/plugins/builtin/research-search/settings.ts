import {
  buildColumnVisibilityField,
  resolveVisibleColumns,
} from "../../../components/data-table/column-settings";
import { buildSortSelectField } from "../../../components/data-table/sort-settings";
import type { CloudSearchSort } from "../../../api-client";
import type { PaneSettingsContext, PaneSettingsDef } from "../../../types/plugin";
import { getSharedRegistry } from "../../registry";
import {
  DEFAULT_FILTERS,
  DOC_TYPE_OPTIONS,
  RANGE_OPTIONS,
  RESEARCH_SEARCH_COLUMN_DEFS,
  RESEARCH_SEARCH_COLUMN_IDS,
  SORT_OPTIONS,
  parseTickerFilter,
  type SearchColumnId,
  type SearchDocumentType,
  type SearchFilters,
  type SearchRangeKey,
} from "./model";

export type ResearchSearchView = "results" | "saved";

const VIEW_OPTIONS = [
  { value: "results", label: "Results" },
  { value: "saved", label: "Saved searches" },
] as const;

const SORT_VALUES: readonly CloudSearchSort[] = ["relevance", "newest", "oldest"];
const RANGE_VALUES: readonly SearchRangeKey[] = ["all", "7d", "30d", "1y", "custom"];

export function isResearchSearchView(value: unknown): value is ResearchSearchView {
  return value === "results" || value === "saved";
}

function isSearchSort(value: unknown): value is CloudSearchSort {
  return typeof value === "string" && SORT_VALUES.includes(value as CloudSearchSort);
}

function isSearchRange(value: unknown): value is SearchRangeKey {
  return typeof value === "string" && RANGE_VALUES.includes(value as SearchRangeKey);
}

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function coerceDocTypes(value: unknown): SearchDocumentType[] {
  const allowed = new Set(DOC_TYPE_OPTIONS.map((option) => option.value));
  return coerceStringList(value).filter((entry): entry is SearchDocumentType => (
    allowed.has(entry as SearchDocumentType)
  ));
}

export function tickerFilterText(tickers: readonly string[]): string {
  return tickers.join(" ");
}

export function getResearchSearchSettings(settings: Record<string, unknown> | undefined): {
  query: string;
  view: ResearchSearchView;
  filters: SearchFilters;
  columnIds: SearchColumnId[];
} {
  const tickers = typeof settings?.tickers === "string"
    ? parseTickerFilter(settings.tickers)
    : Array.isArray(settings?.tickers)
      ? parseTickerFilter(settings.tickers.join(" "))
      : [];
  const columnIds = resolveVisibleColumns(
    RESEARCH_SEARCH_COLUMN_DEFS,
    settings?.columnIds,
    RESEARCH_SEARCH_COLUMN_IDS,
  ).map((column) => column.id as SearchColumnId);

  return {
    query: typeof settings?.query === "string" ? settings.query.trim() : "",
    view: isResearchSearchView(settings?.view) ? settings.view : "results",
    filters: {
      tickers,
      docTypes: coerceDocTypes(settings?.docTypes),
      sourceIds: coerceStringList(settings?.sourceIds),
      range: isSearchRange(settings?.range) ? settings.range : DEFAULT_FILTERS.range,
      from: typeof settings?.from === "string" ? settings.from : undefined,
      to: typeof settings?.to === "string" ? settings.to : undefined,
      sort: isSearchSort(settings?.sort) ? settings.sort : DEFAULT_FILTERS.sort,
    },
    columnIds: columnIds.length > 0 ? columnIds : [...RESEARCH_SEARCH_COLUMN_IDS],
  };
}

function sourceOptions() {
  return [
    { value: "cloud", label: "Gloom Cloud" },
    ...(getSharedRegistry()?.getAvailableDocumentSearchProviders() ?? []).map((provider) => ({
      value: provider.id,
      label: provider.name,
    })),
  ];
}

export function buildResearchSearchSettingsDef(
  context: PaneSettingsContext,
): PaneSettingsDef {
  const resolved = getResearchSearchSettings(context.settings);
  const sources = sourceOptions();
  return {
    title: "Research Search Settings",
    values: {
      query: resolved.query,
      view: resolved.view,
      tickers: tickerFilterText(resolved.filters.tickers),
      docTypes: [...resolved.filters.docTypes],
      sourceIds: [...(resolved.filters.sourceIds ?? [])],
      range: resolved.filters.range === "custom" ? "all" : resolved.filters.range,
      sort: resolved.filters.sort,
      columnIds: [...resolved.columnIds],
    },
    fields: [
      {
        key: "view",
        label: "View",
        description: "Results of the current query, or saved searches and keyword alerts.",
        type: "select",
        options: [...VIEW_OPTIONS],
      },
      {
        key: "tickers",
        label: "Tickers",
        description: "Limit hits to these symbols. Empty means every ticker.",
        type: "text",
        placeholder: "AAPL MSFT",
      },
      {
        key: "docTypes",
        label: "Types",
        description: "Empty means calls, news, and filings.",
        type: "multi-select",
        options: [...DOC_TYPE_OPTIONS],
      },
      ...(sources.length > 1 ? [{
        key: "sourceIds",
        label: "Sources",
        description: "Empty means every available document source.",
        type: "multi-select" as const,
        options: sources,
      }] : []),
      {
        key: "range",
        label: "Range",
        description: "Publication window for this pane.",
        type: "select",
        options: RANGE_OPTIONS
          .filter((option) => option.value !== "custom")
          .map((option) => ({ value: option.value, label: option.label })),
      },
      buildSortSelectField(
        SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
        { label: "Sort", description: "Relevance, or date. Header click on DATE also toggles newest/oldest." },
      ),
      buildColumnVisibilityField([...RESEARCH_SEARCH_COLUMN_DEFS]),
    ],
  };
}
