import type { CorporateActionsData } from "../../../types/financials";
import { buildEventRows, type EventRow } from "./corporate-actions-pane";

export type PortfolioEventRow = EventRow & { symbol: string; name?: string };

export function buildPortfolioEventRows(
  entries: Iterable<{ symbol: string; name?: string; currency: string; data: CorporateActionsData | null }>,
): PortfolioEventRow[] {
  const seen = new Set<string>();
  const rows: PortfolioEventRow[] = [];
  for (const entry of entries) {
    const symbol = entry.symbol.trim().toUpperCase();
    if (!symbol) continue;
    for (const row of buildEventRows(entry.data, null, null, entry.currency)) {
      const id = `${symbol}:${row.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ ...row, id, symbol, name: entry.name });
    }
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date) || left.symbol.localeCompare(right.symbol));
}
