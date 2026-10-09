import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchCongressBills, type CongressBill } from "./client";
import { newestActionDate } from "./model";

function row(bill: CongressBill) {
  return {
    id: bill.id,
    number: bill.number,
    title: bill.title,
    actionDate: bill.actionDate,
    actionText: bill.actionText,
  };
}

export const congressBillsHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  describe: "Newest bill actions",
  discovery: {
    aliases: ["BILLS"],
    dataRequirements: ["Bill list sorted by update date"],
    limitations: ["The forty most recently updated bills", "Latest action is the list summary, not the full history"],
  },
  async load(_args, ctx) {
    const bills = await fetchCongressBills(ctx.signal);
    return {
      complete: true,
      sections: [{
        title: "Bills",
        columns: [
          { key: "number", header: "Number" },
          { key: "title", header: "Title" },
          { key: "actionDate", header: "Action date" },
          { key: "actionText", header: "Latest action" },
        ],
        rows: bills.map(row),
      }],
      metadata: { count: bills.length, newestActionDate: newestActionDate(bills) },
    };
  },
};
