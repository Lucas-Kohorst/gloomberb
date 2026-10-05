import type { TickerFinancials } from "../../../types/financials";
import {
  canonicalTimeSeriesFieldId,
  isFundamentalFieldId,
  isPriceOnlyMarketFieldId,
} from "../../../time-series/field-catalog";
import { extractFundamentalSeries } from "../../../time-series/fundamentals";
import { evaluateFormula, parseFormula } from "./formula";
import { catalogColumnField, type ViewColumn, type ViewRow, type ViewSpec } from "./view-spec";

export const WORKSHEET_JOIN_CAP = 40;

export interface QuoteScalars {
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface WorksheetJoinDeps {
  quotes?(symbols: string[], signal: AbortSignal): Promise<ReadonlyMap<string, QuoteScalars>>;
  financials?(symbol: string, exchange: string, signal: AbortSignal): Promise<TickerFinancials | null>;
  paneResult?(pane: string, symbol: string, signal: AbortSignal): Promise<Record<string, unknown> | null>;
}

export function worksheetNeedsJoin(columns: readonly ViewColumn[]): boolean {
  return columns.some((column) => column.formula || column.from || catalogColumnField(column));
}

function rowSymbol(row: ViewRow, symbolKey: string): string {
  const value = row[symbolKey] ?? row.symbol;
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function quoteScalar(quote: QuoteScalars, fieldId: string): number | null {
  switch (canonicalTimeSeriesFieldId(fieldId)) {
    case "market.open": return quote.open;
    case "market.high": return quote.high;
    case "market.low": return quote.low;
    case "market.volume": return quote.volume;
    case "market.close":
    case "market.ohlcv":
      return quote.price;
    default:
      return null;
  }
}

function latestFundamental(financials: TickerFinancials, symbol: string, exchange: string, fieldId: string): number | null {
  for (const period of ["quarterly", "annual"] as const) {
    const points = extractFundamentalSeries(financials, {
      kind: "security",
      instrument: { symbol, exchange },
      fieldId,
      period,
    });
    const value = points.at(-1)?.value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function cellFromResult(result: Record<string, unknown>, field: string): unknown {
  const rows = Array.isArray(result.rows) ? result.rows : Array.isArray(result.items) ? result.items : null;
  const first = rows?.find((row) => row && typeof row === "object");
  if (first && field in (first as Record<string, unknown>)) return (first as Record<string, unknown>)[field] ?? null;
  if (Array.isArray(result.series)) {
    const series = result.series.find((entry) => (
      entry && typeof entry === "object" && ((entry as { id?: string }).id === field || (entry as { label?: string }).label === field)
    )) ?? result.series[0];
    if (!series || typeof series !== "object") return null;
    const points = (series as { points?: unknown }).points;
    if (!Array.isArray(points) || points.length === 0) return null;
    const last = points[points.length - 1];
    if (!last || typeof last !== "object") return null;
    const point = last as { value?: unknown; close?: unknown };
    return point.value ?? point.close ?? null;
  }
  if (Array.isArray(result.sections)) {
    const section = result.sections.find((entry) => entry && typeof entry === "object") as {
      rows?: ViewRow[];
      entries?: Array<{ label: string; value: unknown }>;
    } | undefined;
    const row = section?.rows?.find((entry) => entry && typeof entry === "object");
    if (row && field in row) return row[field] ?? null;
    const labeled = section?.entries?.find((entry) => entry.label === field);
    return labeled?.value ?? null;
  }
  return null;
}

async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function joinWorksheetColumns(
  rows: readonly ViewRow[],
  spec: ViewSpec,
  signal: AbortSignal,
  deps: WorksheetJoinDeps,
): Promise<{ rows: ViewRow[]; errors: string[] }> {
  const columns = spec.projection.columns;
  if (!worksheetNeedsJoin(columns)) return { rows: rows.map((row) => ({ ...row })), errors: [] };
  const symbolKey = spec.presentation.symbolKey ?? "symbol";
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const symbol = rowSymbol(row, symbolKey);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  const joined = symbols.slice(0, WORKSHEET_JOIN_CAP);
  const errors: string[] = [];
  if (symbols.length > joined.length) {
    errors.push(`Joined ${joined.length} of ${symbols.length} symbols. Narrow the sheet to fill the rest.`);
  }

  const catalog = columns.flatMap((column) => {
    const fieldId = catalogColumnField(column);
    return fieldId ? [{ key: column.key, fieldId }] : [];
  });
  const dividend = catalog.some((column) => canonicalTimeSeriesFieldId(column.fieldId) === "market.dividends");
  if (dividend) errors.push("Dividends are a history, not a latest worksheet value.");
  const quoteFields = catalog.filter((column) => isPriceOnlyMarketFieldId(column.fieldId));
  const statementFields = catalog.filter((column) => isFundamentalFieldId(column.fieldId));
  const quotes = quoteFields.length > 0 && deps.quotes
    ? await deps.quotes(joined, signal)
    : new Map<string, QuoteScalars>();

  const financials = new Map<string, TickerFinancials | null>();
  if (statementFields.length > 0 && deps.financials) {
    const load = deps.financials;
    await mapPool(joined, 4, async (symbol) => {
      const exchange = rows.find((row) => rowSymbol(row, symbolKey) === symbol);
      const listed = typeof exchange?.exchange === "string" ? exchange.exchange : "";
      financials.set(symbol, await load(symbol, listed, signal).catch(() => null));
    });
  }

  const paneResults = new Map<string, Record<string, unknown> | null>();
  const paneColumns = columns.filter((column) => column.from);
  const failedPanes = new Set<string>();
  if (paneColumns.length > 0 && deps.paneResult) {
    const panes = [...new Set(paneColumns.map((column) => column.from!.pane))];
    const load = deps.paneResult;
    for (const pane of panes) {
      await mapPool(joined, 4, async (symbol) => {
        const cacheKey = `${pane}\n${symbol}`;
        try {
          paneResults.set(cacheKey, await load(pane, symbol, signal));
        } catch {
          paneResults.set(cacheKey, null);
          failedPanes.add(pane);
        }
      });
    }
  }
  for (const pane of failedPanes) errors.push(`${pane} did not load for some symbols.`);

  const next = rows.map((row) => {
    const copy: ViewRow = { ...row };
    const symbol = rowSymbol(row, symbolKey);
    if (!symbol || !joined.includes(symbol)) return copy;
    const quote = quotes.get(symbol);
    for (const column of quoteFields) {
      copy[column.key] = quote ? quoteScalar(quote, column.fieldId) : null;
    }
    const snapshot = financials.get(symbol);
    for (const column of statementFields) {
      const exchange = typeof row.exchange === "string" ? row.exchange : "";
      copy[column.key] = snapshot ? latestFundamental(snapshot, symbol, exchange, column.fieldId) : null;
    }
    for (const column of paneColumns) {
      const result = paneResults.get(`${column.from!.pane}\n${symbol}`);
      copy[column.key] = result ? cellFromResult(result, column.from!.field) : null;
    }
    return copy;
  });

  for (const column of columns) {
    if (!column.formula) continue;
    const parsed = parseFormula(column.formula);
    if (!parsed) continue;
    for (const row of next) {
      row[column.key] = evaluateFormula(parsed, (name) => row[name]);
    }
  }
  return { rows: next, errors };
}
