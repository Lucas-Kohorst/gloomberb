import type { DataTableColumn } from "../../../components";
import { compareSortValues, type SortDirection, type SortPreference } from "../../../utils/sort-values";
import { formatNumber } from "../../../utils/format";

export const BANK_FINANCIALS_PANE_ID = "bank-financials";

export interface BankBalance {
  id: string;
  name: string;
  state: string;
  /** Total assets, billions of dollars. */
  assets: number | null;
  /** Total deposits, billions of dollars. */
  deposits: number | null;
  reportDate: string | null;
}

export interface BankBoard {
  banks: BankBalance[];
  reportDate: string | null;
}

export type BankColumnId = "bank" | "state" | "assets" | "deposits";
export type BankColumn = DataTableColumn & { id: BankColumnId };
export type BankSortPreference = SortPreference<BankColumnId>;

export const BANK_COLUMNS: BankColumn[] = [
  { id: "bank", label: "Bank", width: 22, align: "left", flexGrow: 1 },
  { id: "state", label: "State", width: 16, align: "left" },
  { id: "assets", label: "Assets $B", width: 12, align: "right" },
  { id: "deposits", label: "Deposits $B", width: 13, align: "right" },
];

export const DEFAULT_BANK_SORT: BankSortPreference = { columnId: "assets", direction: "desc" };

export function firstBankSortDirection(columnId: BankColumnId): SortDirection {
  return columnId === "assets" || columnId === "deposits" ? "desc" : "asc";
}

export function formatBillions(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return formatNumber(value, 1);
}

export function filterBanks(banks: readonly BankBalance[], query: string): BankBalance[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...banks];
  return banks.filter((bank) => bank.name.toLowerCase().includes(needle));
}

function sortValue(columnId: BankColumnId, bank: BankBalance): string | number | null {
  switch (columnId) {
    case "bank":
      return bank.name;
    case "state":
      return bank.state || null;
    case "assets":
      return bank.assets;
    case "deposits":
      return bank.deposits;
  }
}

export function sortBanks(banks: readonly BankBalance[], sort: BankSortPreference): BankBalance[] {
  const columnId = sort.columnId;
  if (!columnId) return [...banks];
  return [...banks].sort((a, b) => {
    const compared = compareSortValues(sortValue(columnId, a), sortValue(columnId, b), sort.direction);
    return compared !== 0 ? compared : a.name.localeCompare(b.name);
  });
}
