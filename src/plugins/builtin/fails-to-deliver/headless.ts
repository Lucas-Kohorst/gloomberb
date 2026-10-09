import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { formatNumber } from "../../../utils/format";
import { fetchFails } from "./client";
import { failSymbol } from "./model";

const quantityText = (value: unknown) => typeof value === "number" ? formatNumber(value, 0) : "--";
const priceText = (value: unknown) => typeof value === "number" ? value.toFixed(2) : "--";

/** Optional ticker. Omit it for the largest balances in the newest file. */
export const failsToDeliverHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: {
    kind: "free-text",
    optional: true,
    placeholder: "ticker",
    description: "Optional ticker. Omit it for the largest balances.",
  },
  options: [],
  discovery: {
    aliases: ["FTD"],
    dataRequirements: ["Published share-delivery fail balances"],
    limitations: [
      "A half-month file, posted around month-end and the middle of the next month",
      "The balance is everything still outstanding, not that day's new fails",
      "A price is the prior close when it was published and above one penny",
    ],
  },
  describe: "Largest outstanding share-delivery fails",
  async load(args, ctx) {
    const argument = Array.isArray(args.argument) ? args.argument.join(" ") : args.argument ?? "";
    const stored = typeof ctx.settings?.symbol === "string" ? ctx.settings.symbol : "";
    const symbol = failSymbol(argument || stored);
    const report = await fetchFails(symbol, ctx.signal);
    return {
      complete: true,
      sections: [{
        title: report.settlementDate ? `Settlement ${report.settlementDate}` : "Fails to deliver",
        columns: [
          { key: "symbol", header: "Symbol" },
          { key: "description", header: "Description" },
          { key: "quantity", header: "Quantity", align: "right", format: quantityText },
          { key: "price", header: "Price", align: "right", format: priceText },
          { key: "date", header: "Date" },
        ],
        rows: report.rows.map((row) => ({
          symbol: row.symbol,
          description: row.description,
          quantity: row.quantity,
          price: row.price,
          date: row.date,
        })),
      }],
      metadata: { settlementDate: report.settlementDate, symbol: symbol || null },
    };
  },
};
