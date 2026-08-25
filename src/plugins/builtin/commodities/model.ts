import { compareSortValues, type SortDirection } from "../../../utils/sort-values";
import type { BoardQuoteMap } from "../shared/use-quote-board";
import {
  COMMODITY_SECTOR_ORDER,
  type CommodityContract,
  type CommoditySector,
} from "./contracts";

export type CommodityTableRow =
  | { type: "header"; sector: CommoditySector }
  | { type: "row"; contract: CommodityContract };

export type CommodityColumnId = "status" | "code" | "name" | "price" | "change" | "changePercent";

export interface CommoditySortPreference {
  columnId: CommodityColumnId | null;
  direction: SortDirection;
}

export const DEFAULT_COMMODITY_SORT: CommoditySortPreference = {
  columnId: null,
  direction: "asc",
};

function getSortValue(
  columnId: CommodityColumnId,
  contract: CommodityContract,
  quotes: BoardQuoteMap,
): string | number | null {
  const quote = quotes.get(contract.symbol)?.quote;
  switch (columnId) {
    case "status":
      return quote?.marketState === "REGULAR" ? 0 : 1;
    case "code":
      return contract.code;
    case "name":
      return contract.name;
    case "price":
      return quote?.price ?? null;
    case "change":
      return quote?.change ?? null;
    case "changePercent":
      return quote?.changePercent ?? null;
  }
}

function sortContracts(
  contracts: CommodityContract[],
  sortPreference: CommoditySortPreference,
  quotes: BoardQuoteMap,
): CommodityContract[] {
  const columnId = sortPreference.columnId;
  if (!columnId) return contracts;
  return [...contracts].sort((left, right) => compareSortValues(
    getSortValue(columnId, left, quotes),
    getSortValue(columnId, right, quotes),
    sortPreference.direction,
  ));
}

export function buildCommodityRows(
  contractsBySector: Map<CommoditySector, CommodityContract[]>,
  sortPreference: CommoditySortPreference,
  quotes: BoardQuoteMap,
  options?: {
    filter?: (contract: CommodityContract) => boolean;
    collapsed?: ReadonlySet<CommoditySector>;
  },
): CommodityTableRow[] {
  const rows: CommodityTableRow[] = [];
  for (const sector of COMMODITY_SECTOR_ORDER) {
    const contracts = sortContracts(contractsBySector.get(sector) ?? [], sortPreference, quotes);
    const visible = options?.filter ? contracts.filter(options.filter) : contracts;
    if (visible.length === 0) continue;
    rows.push({ type: "header", sector });
    if (!options?.collapsed?.has(sector)) {
      for (const contract of visible) rows.push({ type: "row", contract });
    }
  }
  return rows;
}

export function nextCommoditySort(
  current: CommoditySortPreference,
  columnId: string,
): CommoditySortPreference {
  const typed = columnId as CommodityColumnId;
  if (current.columnId !== typed) return { columnId: typed, direction: "desc" };
  if (current.direction === "desc") return { columnId: typed, direction: "asc" };
  return DEFAULT_COMMODITY_SORT;
}
