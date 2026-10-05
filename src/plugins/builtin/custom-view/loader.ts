import type { HeadlessPaneColumn } from "../../../types/headless";
import { NUMERIC_FIELDS, type ScreenDefinition, type ScreenRow } from "../../../api-client/equity-screener";
import { loadResolvedHeadlessPaneModel, serializeHeadlessPaneResult } from "../../../cli/pane-functions/headless";
import { resolvePaneFunction } from "../../../cli/pane-functions/resolver";
import type { AppConfig } from "../../../types/config";
import { getSharedRegistry } from "../../registry";
import { marketContextFromRegistry } from "../cloud/askg/host";
import { getTimeSeriesField } from "../../../time-series/field-catalog";
import { fetchScreen, type ScreenerClient } from "../equity-screener/client";
import { parseScreenDefinition, SHORT_LABELS } from "../equity-screener/model";
import { joinWorksheetColumns, worksheetNeedsJoin, type QuoteScalars, type WorksheetJoinDeps } from "./join";
import type { ViewColumn, ViewRow, ViewSource, ViewSpec } from "./view-spec";

export interface LoadedView {
  rows: ViewRow[];
  columns: HeadlessPaneColumn[];
  errors: string[];
  sourceLabel: string;
}

/** Turns a `ref` source into its inline spec; installed by the cloud views module. */
export type ViewRefResolver = (source: Extract<ViewSource, { kind: "ref" }>) => Promise<ViewSpec | null>;

let refResolver: ViewRefResolver | null = null;

export function setViewRefResolver(resolver: ViewRefResolver | null): void {
  refResolver = resolver;
}

function rowsFromResult(result: Record<string, unknown>): { rows: ViewRow[]; columns: HeadlessPaneColumn[] } {
  if (Array.isArray(result.rows)) {
    return { rows: result.rows as ViewRow[], columns: (result.columns as HeadlessPaneColumn[] | undefined) ?? [] };
  }
  if (Array.isArray(result.items)) {
    return { rows: result.items as ViewRow[], columns: (result.columns as HeadlessPaneColumn[] | undefined) ?? [] };
  }
  if (Array.isArray(result.sections)) {
    // A bundle flattens into one table with a section column.
    const rows: ViewRow[] = [];
    const columns = new Map<string, HeadlessPaneColumn>([["section", { key: "section", header: "Section" }]]);
    for (const section of result.sections as Array<{ title: string; rows?: ViewRow[]; entries?: Array<{ label: string; value: unknown }>; columns?: HeadlessPaneColumn[] }>) {
      for (const column of section.columns ?? []) columns.set(column.key, column);
      for (const row of section.rows ?? []) rows.push({ section: section.title, ...row });
      for (const entry of section.entries ?? []) rows.push({ section: section.title, label: entry.label, value: entry.value });
    }
    return { rows, columns: [...columns.values()] };
  }
  if (Array.isArray(result.series)) {
    // A series flattens into rows of date plus one column per series.
    const byDate = new Map<string, ViewRow>();
    const columns: HeadlessPaneColumn[] = [{ key: "date", header: "Date" }];
    for (const series of result.series as Array<{ id: string; label: string; points: Array<Record<string, unknown>> }>) {
      columns.push({ key: series.id, header: series.label, align: "right" });
      for (const point of series.points) {
        const date = String(point.date);
        const row = byDate.get(date) ?? { date };
        row[series.id] = point.value ?? point.close ?? null;
        byDate.set(date, row);
      }
    }
    return { rows: [...byDate.values()], columns };
  }
  return { rows: [], columns: [] };
}

const EQUITY_FETCH_CAP = 500;
const TICKER_QUERY_CHUNK = 25;
const DEFAULT_EQUITY_COLUMNS = ["symbol", "name", "price", "changePercent", "marketCap", "trailingPE"];
const IDENTITY_HEADERS: Record<string, string> = {
  symbol: "Symbol",
  name: "Name",
  exchange: "Exchange",
  sector: "Sector",
  industry: "Industry",
  currency: "Currency",
};
const LIVE_HEADERS: Record<string, string> = {
  price: "Last",
  changePercent: "Change %",
  volume: "Volume",
};
const TEXT_KEYS = new Set(Object.keys(IDENTITY_HEADERS));

function screenRowToViewRow(row: ScreenRow): ViewRow {
  const view: ViewRow = {
    symbol: row.symbol,
    exchange: row.exchange,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    currency: row.currency,
  };
  for (const field of NUMERIC_FIELDS) view[field] = row.metrics[field]?.value ?? null;
  return view;
}

function columnHeader(column: Pick<ViewColumn, "key" | "from">): string {
  const equityHeader = (SHORT_LABELS as Record<string, string>)[column.key];
  return LIVE_HEADERS[column.key]
    ?? IDENTITY_HEADERS[column.key]
    ?? equityHeader
    ?? getTimeSeriesField(column.key)?.shortLabel
    ?? column.from?.field
    ?? column.key;
}

function equityColumns(spec: ViewSpec): HeadlessPaneColumn[] {
  const columns: Array<Pick<ViewColumn, "key" | "from">> = spec.projection.columns.length > 0
    ? spec.projection.columns
    : DEFAULT_EQUITY_COLUMNS.map((key) => ({ key }));
  return columns.map((column) => ({
    key: column.key,
    header: columnHeader(column),
    align: TEXT_KEYS.has(column.key) || column.from ? "left" as const : "right" as const,
  }));
}

function withSpecColumns(spec: ViewSpec, columns: HeadlessPaneColumn[]): HeadlessPaneColumn[] {
  if (spec.projection.columns.length === 0) return columns;
  const known = new Map(columns.map((column) => [column.key, column]));
  return spec.projection.columns.map((column) => known.get(column.key) ?? {
    key: column.key,
    header: columnHeader(column),
    align: column.from ? "left" as const : "right" as const,
  });
}

function equityLimit(spec: ViewSpec): number {
  const requested = spec.projection.limit ?? 100;
  return Math.min(Math.max(requested, 1), EQUITY_FETCH_CAP);
}

async function loadScreenRows(
  definition: ScreenDefinition,
  limit: number,
  signal: AbortSignal,
  client: ScreenerClient | undefined,
): Promise<{ rows: ViewRow[]; errors: string[] }> {
  const rows: ViewRow[] = [];
  let cursor: string | null = null;
  let matched = 0;
  do {
    const page = await fetchScreen(definition, cursor, signal, client);
    matched = page.universe.matched;
    for (const row of page.rows) {
      if (rows.length >= limit) break;
      rows.push(screenRowToViewRow(row));
    }
    cursor = rows.length >= limit ? null : page.nextCursor;
  } while (cursor);
  const errors = rows.length < matched
    ? [`Showing ${rows.length} of ${matched}. Narrow the screen to see the rest.`]
    : [];
  return { rows, errors };
}

function tickerScreen(symbols: string[]): ScreenDefinition {
  return {
    version: 1,
    currency: "USD",
    criteria: [{ field: "symbol", op: "in", value: symbols }],
    sort: { field: "marketCap", direction: "desc" },
  };
}

async function loadTickerRows(
  symbols: string[],
  signal: AbortSignal,
  client: ScreenerClient | undefined,
): Promise<ViewRow[]> {
  const bySymbol = new Map<string, ViewRow>();
  // Category `in` accepts at most 25 values.
  for (let start = 0; start < symbols.length; start += TICKER_QUERY_CHUNK) {
    const page = await fetchScreen(tickerScreen(symbols.slice(start, start + TICKER_QUERY_CHUNK)), null, signal, client);
    for (const row of page.rows) bySymbol.set(row.symbol, screenRowToViewRow(row));
  }
  return symbols.flatMap((symbol) => {
    const row = bySymbol.get(symbol);
    return row ? [row] : [];
  });
}

async function liveJoinDeps(config: AppConfig, signal: AbortSignal): Promise<WorksheetJoinDeps> {
  const registry = getSharedRegistry();
  if (!registry) throw new Error("The plugin registry is not available.");
  const context = marketContextFromRegistry(registry, config);
  const provider = context.dataProvider;
  return {
    quotes: async (symbols, quoteSignal) => {
      if (quoteSignal.aborted) return new Map();
      if (!provider.getQuotesBatch) return new Map();
      const results = await provider.getQuotesBatch(symbols.map((symbol) => ({ symbol, exchange: "" })));
      const quotes = new Map<string, QuoteScalars>();
      results.forEach((result, index) => {
        const symbol = (result.quote?.symbol ?? symbols[index] ?? "").toUpperCase();
        if (!symbol || !result.quote) return;
        quotes.set(symbol, {
          price: result.quote.price ?? null,
          open: result.quote.open ?? null,
          high: result.quote.high ?? null,
          low: result.quote.low ?? null,
          volume: result.quote.volume ?? null,
        });
      });
      return quotes;
    },
    financials: (symbol, exchange) => provider.getTickerFinancials(symbol, exchange).catch(() => null),
    paneResult: async (pane, symbol) => {
      const resolved = await resolvePaneFunction(registry, context, {
        target: pane,
        arg: symbol,
        options: {},
        outputPath: null,
        width: 1280,
        height: 720,
        theme: null,
        scale: 1,
        watermark: null,
        requireBotSafe: false,
      }, { strictHeadlessOptions: true });
      const kind = resolved.headless?.argument.kind;
      if (!resolved.headless || (kind !== "ticker" && kind !== "tickers" && kind !== "symbol-list")) {
        throw new Error(`${pane} is not keyed by a symbol.`);
      }
      const loaded = await loadResolvedHeadlessPaneModel(resolved, context, symbol, signal);
      return serializeHeadlessPaneResult(loaded.definition, loaded.result);
    },
  };
}

async function finishLoaded(
  spec: ViewSpec,
  loaded: LoadedView,
  config: AppConfig,
  signal: AbortSignal,
  deps?: WorksheetJoinDeps,
): Promise<LoadedView> {
  const columns = withSpecColumns(spec, loaded.columns);
  if (!worksheetNeedsJoin(spec.projection.columns)) return { ...loaded, columns };
  const joined = await joinWorksheetColumns(loaded.rows, spec, signal, deps ?? await liveJoinDeps(config, signal));
  return {
    ...loaded,
    rows: joined.rows,
    columns,
    errors: [...loaded.errors, ...joined.errors],
  };
}

/**
 * Inline sources use the headless loader ASKG and the CLI use.
 * A screen or a ticker list reads equity-screener metrics directly.
 * Chart fields, ticker-keyed functions, and formulas are joined onto those rows.
 */
export async function loadViewSource(
  spec: ViewSpec,
  config: AppConfig,
  signal: AbortSignal,
  depth = 0,
  client?: ScreenerClient,
  deps?: WorksheetJoinDeps,
): Promise<LoadedView> {
  if (spec.source.kind === "ref") {
    if (depth > 2) throw new Error("This view references itself.");
    if (!refResolver) throw new Error("Team views are not available right now.");
    const resolved = await refResolver(spec.source);
    if (!resolved) throw new Error("The referenced team view no longer exists.");
    return loadViewSource(resolved, config, signal, depth + 1, client, deps);
  }
  if (spec.source.kind === "screen" || spec.source.kind === "tickers") {
    const loaded = spec.source.kind === "screen"
      ? await loadScreenRows(parseScreenDefinition(spec.source.definition), equityLimit(spec), signal, client)
      : { rows: await loadTickerRows(spec.source.symbols, signal, client), errors: [] };
    return finishLoaded(spec, {
      rows: loaded.rows,
      columns: equityColumns(spec),
      errors: loaded.errors,
      sourceLabel: spec.source.kind === "screen" ? "Equity screener" : "Tickers",
    }, config, signal, deps);
  }
  const registry = getSharedRegistry();
  if (!registry) throw new Error("The plugin registry is not available.");
  const options: Record<string, string | true> = {};
  for (const [key, value] of Object.entries(spec.source.options ?? {})) {
    options[key] = value === true ? true : String(value);
  }
  const context = marketContextFromRegistry(registry, config);
  const resolved = await resolvePaneFunction(registry, context, {
    target: spec.source.pane,
    arg: spec.source.argument ?? "",
    options,
    outputPath: null,
    width: 1280,
    height: 720,
    theme: null,
    scale: 1,
    watermark: null,
    requireBotSafe: false,
  }, { strictHeadlessOptions: true });
  if (!resolved.headless) throw new Error(`${resolved.label} has no data function to build a view from.`);
  const loaded = await loadResolvedHeadlessPaneModel(resolved, context, spec.source.argument ?? "", signal);
  const serialized = serializeHeadlessPaneResult(loaded.definition, loaded.result);
  const { rows, columns } = rowsFromResult(serialized);
  return finishLoaded(spec, {
    rows,
    columns,
    errors: (loaded.result.errors ?? []).filter(Boolean),
    sourceLabel: resolved.label,
  }, config, signal, deps);
}
