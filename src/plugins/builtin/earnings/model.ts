import type { EarningsEvent } from "../../../types/data-provider";
import type { TickerRecord } from "../../../types/ticker";
import { parseTickerListInput } from "../../../tickers/list";

export type EarningsDisplayRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "event"; key: string; event: EarningsEvent; eventIdx: number };

export type EarningsEventDisplayRow = EarningsDisplayRow & { kind: "event" };

export function resolveEarningsMonitorSymbols(scopedSymbols: string[], fallbackSymbols: string[]): string[] {
  return scopedSymbols.length > 0 ? scopedSymbols : fallbackSymbols;
}

export function resolveEarningsCollectionId(
  settings: Record<string, unknown> | undefined,
  legacyFallbackId: string | null,
): string | null {
  const configuredId = settings?.collectionId;
  if (typeof configuredId === "string" && configuredId.trim()) {
    return configuredId.trim();
  }
  return legacyFallbackId;
}

export function trackedEarningsSymbols(
  tickers: Iterable<TickerRecord>,
  collectionId: string | null,
): string[] {
  const symbols = new Set<string>();

  for (const ticker of tickers) {
    const { metadata } = ticker;
    const tracked = collectionId
      ? metadata.portfolios.includes(collectionId) || metadata.watchlists.includes(collectionId)
      : metadata.portfolios.length > 0 || metadata.watchlists.length > 0;
    if (!tracked) continue;

    const symbol = metadata.ticker.trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }

  return [...symbols];
}

export function scopedSymbolsFromSettings(settings: Record<string, unknown> | undefined): string[] {
  const symbols = settings?.symbols;
  if (Array.isArray(symbols)) {
    return symbols
      .filter((symbol): symbol is string => typeof symbol === "string" && symbol.trim().length > 0)
      .map((symbol) => symbol.trim().toUpperCase());
  }
  const symbolsText = settings?.symbolsText;
  if (typeof symbolsText !== "string" || !symbolsText.trim()) return [];
  try {
    return parseTickerListInput(symbolsText);
  } catch {
    return [];
  }
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function groupEarningsByRelativeDate(
  events: EarningsEvent[],
  now = new Date(),
): EarningsDisplayRow[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = startOfUtcDay(now);
  const tomorrow = today + dayMs;
  const dayAfterTomorrow = today + 2 * dayMs;
  const endOfWeek = today + (7 - new Date(today).getUTCDay()) * dayMs;
  const endOfNextWeek = endOfWeek + 7 * dayMs;

  const groups: { label: string; events: EarningsEvent[] }[] = [
    { label: "TODAY", events: [] },
    { label: "TOMORROW", events: [] },
    { label: "THIS WEEK", events: [] },
    { label: "NEXT WEEK", events: [] },
    { label: "LATER", events: [] },
  ];

  for (const event of events) {
    const date = startOfUtcDay(event.earningsDate);
    if (date === today) {
      groups[0]!.events.push(event);
    } else if (date === tomorrow) {
      groups[1]!.events.push(event);
    } else if (date > tomorrow && date < endOfWeek) {
      groups[2]!.events.push(event);
    } else if (date >= endOfWeek && date < endOfNextWeek) {
      groups[3]!.events.push(event);
    } else if (date >= endOfNextWeek) {
      groups[4]!.events.push(event);
    }
  }

  const rows: EarningsDisplayRow[] = [];
  let eventIdx = 0;
  for (const group of groups) {
    if (group.events.length === 0) continue;
    rows.push({ kind: "separator", key: `sep-${group.label}`, label: `${group.label} (${group.events.length})` });
    for (const event of group.events) {
      rows.push({
        kind: "event",
        key: `event-${event.symbol}-${event.earningsDate.getTime()}-${eventIdx}`,
        event,
        eventIdx,
      });
      eventIdx++;
    }
  }
  return rows;
}
