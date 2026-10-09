import type { DataTableColumn } from "../../../components";
import type { CongressBill } from "./client";

export const CONGRESS_BILLS_PANE_ID = "congress-bills";

export type BillColumnId = "number" | "title" | "date" | "action";
export type BillColumn = DataTableColumn & { id: BillColumnId };

export const BILL_COLUMNS: BillColumn[] = [
  { id: "number", label: "Number", width: 14, align: "left" },
  { id: "title", label: "Title", width: 24, align: "left", flexGrow: 2 },
  { id: "date", label: "Action date", width: 12, align: "left" },
  { id: "action", label: "Latest action", width: 24, align: "left", flexGrow: 3 },
];

export function newestActionDate(bills: readonly CongressBill[]): string | null {
  let newest = "";
  for (const bill of bills) {
    if (bill.actionDate > newest) newest = bill.actionDate;
  }
  return newest || null;
}

export function billKey(bill: CongressBill): string {
  return bill.id;
}
