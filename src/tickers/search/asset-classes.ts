import type { TickerSearchInstrumentClass } from "./types";

/**
 * Command-bar class codes. The same letters are the badge on a matching
 * instrument. ETF and FUT also open panes; the class row fills the query
 * instead of replacing those commands.
 */
export const ASSET_CLASS_FILTERS = [
  { code: "EQ", label: "Equity", instrumentClass: "equity" },
  { code: "CUR", label: "Currency", instrumentClass: "currency" },
  { code: "OPT", label: "Option", instrumentClass: "option" },
  { code: "FUT", label: "Future", instrumentClass: "future" },
  { code: "IDX", label: "Index", instrumentClass: "index" },
  { code: "ETF", label: "Exchange-Traded Fund", instrumentClass: "etf" },
] as const satisfies ReadonlyArray<{
  code: string;
  label: string;
  instrumentClass: TickerSearchInstrumentClass;
}>;

export type AssetClassCode = (typeof ASSET_CLASS_FILTERS)[number]["code"];
export type AssetClassFilter = (typeof ASSET_CLASS_FILTERS)[number];

const ASSET_CLASS_BY_CODE = new Map<string, AssetClassFilter>(
  ASSET_CLASS_FILTERS.map((entry) => [entry.code, entry]),
);

export function isAssetClassCode(value: string | undefined): value is AssetClassCode {
  return value !== undefined && ASSET_CLASS_BY_CODE.has(value.trim().toUpperCase());
}

export interface ParsedAssetClassQuery {
  /** Class named by the first token, when that token is one of the codes. */
  code: AssetClassCode | null;
  /** Text after the class code. Empty when the query is only the code. */
  symbolQuery: string;
  /** The class list is on screen: the query is a code, or a prefix of one. */
  showMenu: boolean;
}

export function parseAssetClassQuery(query: string): ParsedAssetClassQuery {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) return { code: null, symbolQuery: "", showMenu: false };

  const upper = trimmed.toUpperCase();
  const space = upper.indexOf(" ");
  const first = space === -1 ? upper : upper.slice(0, space);
  const rest = space === -1 ? "" : upper.slice(space + 1).trim();
  const exact = ASSET_CLASS_BY_CODE.get(first);
  if (exact) {
    return { code: exact.code, symbolQuery: rest, showMenu: rest.length === 0 };
  }
  // One letter is still a symbol ("E"). Two or more that start a code open the list.
  if (space !== -1 || first.length < 2) return { code: null, symbolQuery: "", showMenu: false };
  const showMenu = ASSET_CLASS_FILTERS.some((entry) => entry.code.startsWith(first));
  return { code: null, symbolQuery: "", showMenu };
}

/** Rows for the class list. An exact code shows the whole catalog. A prefix shows the matches. */
export function assetClassesForQuery(query: string): readonly AssetClassFilter[] {
  const parsed = parseAssetClassQuery(query);
  if (!parsed.showMenu) return [];
  if (parsed.code) return ASSET_CLASS_FILTERS;
  const upper = query.trim().toUpperCase();
  return ASSET_CLASS_FILTERS.filter((entry) => entry.code.startsWith(upper));
}

export function assetClassSelectionIndex(query: string): number {
  const rows = assetClassesForQuery(query);
  const upper = query.trim().toUpperCase();
  const exact = rows.findIndex((entry) => entry.code === upper);
  return exact >= 0 ? exact : 0;
}

/**
 * Class to keep when the query is a code plus a symbol. A bare code still
 * searches that symbol (EQ finds Equillium), so it does not filter.
 */
export function leadingAssetClassFilter(query: string): TickerSearchInstrumentClass | null {
  const parsed = parseAssetClassQuery(query);
  if (!parsed.code || !parsed.symbolQuery) return null;
  return ASSET_CLASS_BY_CODE.get(parsed.code)?.instrumentClass ?? null;
}

export function assetClassResultId(code: AssetClassCode): string {
  return `asset-class:${code}`;
}

export function isAssetClassResultId(id: string | undefined): boolean {
  return id?.startsWith("asset-class:") === true;
}
