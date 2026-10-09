import type { HeadlessPaneColumn, HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchBankBoard } from "./client";
import { BANK_COLUMNS, filterBanks, formatBillions, type BankBalance } from "./model";

const text = (value: unknown) => typeof value === "string" && value ? value : "--";
const billions = (value: unknown) => typeof value === "number" ? formatBillions(value) : "--";

const COLUMNS: HeadlessPaneColumn[] = BANK_COLUMNS.map((column) => ({
  key: column.id,
  header: column.label,
  align: column.align === "right" ? "right" : "left",
  format: column.id === "assets" || column.id === "deposits" ? billions : text,
}));

function argumentText(argument: string | string[] | null): string {
  return (Array.isArray(argument) ? argument.join(" ") : argument ?? "").trim();
}

function reportRow(bank: BankBalance) {
  return {
    bank: bank.name,
    state: bank.state || null,
    assets: bank.assets,
    deposits: bank.deposits,
  };
}

export const bankFinancialsHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: {
    kind: "free-text",
    optional: true,
    placeholder: "name",
    description: "A bank name. Omit it for the largest active banks.",
  },
  options: [],
  describe: "Largest US bank assets and deposits",
  async load(args, ctx) {
    const board = await fetchBankBoard(ctx.signal);
    const banks = filterBanks(board.banks, argumentText(args.argument));
    return {
      complete: true,
      sections: [{
        title: board.reportDate ? `As of ${board.reportDate}` : "Bank balance sheets",
        columns: COLUMNS,
        rows: banks.map(reportRow),
      }],
      metadata: board.reportDate ? { reportDate: board.reportDate } : {},
    };
  },
};
