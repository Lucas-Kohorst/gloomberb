export const TICKER_HISTORY_LIMIT = 50;

export interface TickerHistory {
  entries: string[];
  index: number;
}

export const EMPTY_TICKER_HISTORY: TickerHistory = { entries: [], index: -1 };

export function pushTickerHistory(history: TickerHistory, symbol: string): TickerHistory {
  if (!symbol || history.entries[history.index] === symbol) return history;
  const entries = [...history.entries.slice(0, history.index + 1), symbol].slice(-TICKER_HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

export function moveTickerHistory(history: TickerHistory, offset: -1 | 1): TickerHistory {
  const index = history.index + offset;
  if (index < 0 || index >= history.entries.length) return history;
  return { ...history, index };
}

export function tickerHistorySymbol(history: TickerHistory): string | null {
  return history.entries[history.index] ?? null;
}
