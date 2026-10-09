import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchPayPerformance } from "./client";
import { formatPayAmount, formatShareholderReturn } from "./model";

const amount = (value: unknown) => formatPayAmount(typeof value === "number" ? value : null);
const shareholderReturn = (value: unknown) => formatShareholderReturn(typeof value === "number" ? value : null);

export const payPerformanceHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: {
    kind: "ticker",
    optional: false,
    placeholder: "ticker",
    description: "Company ticker.",
  },
  options: [],
  discovery: {
    aliases: ["PVP"],
    dataRequirements: ["Filed pay versus performance amounts"],
    limitations: [
      "One row per year. A later filing replaces the same year.",
      "Compensation actually paid is the principal executive when both that figure and the named-officer average are filed.",
      "Shareholder return is the filed amount, usually the value of a fixed investment rather than a percent.",
    ],
  },
  describe: (args) => {
    const ticker = args.symbols[0] ?? (typeof args.argument === "string" ? args.argument : "");
    return ticker ? `Pay versus performance | ${ticker}` : "Pay versus performance";
  },
  async load(args, ctx) {
    const ticker = args.symbols[0] ?? (typeof args.argument === "string" ? args.argument : "");
    if (!ticker.trim()) throw new Error("A ticker is required.");
    const board = await fetchPayPerformance(ticker, ctx.signal);
    return {
      complete: true,
      symbols: [board.ticker],
      sections: [{
        title: board.ticker,
        columns: [
          { key: "year", header: "Year", align: "right" },
          { key: "compensationActuallyPaid", header: "Compensation actually paid", align: "right", format: amount },
          { key: "companyReturn", header: "Company return", align: "right", format: shareholderReturn },
          { key: "peerReturn", header: "Peer return", align: "right", format: shareholderReturn },
        ],
        rows: board.rows.map((row) => ({ ...row })),
      }],
      metadata: { latestYear: board.latestYear },
    };
  },
};
