import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchFundPortfolio } from "./client";
import { formatAssetPercent, formatHoldingValue, formatNetAssets } from "./model";

function tickerFrom(argument: string | string[] | null, raw: string): string {
  if (typeof argument === "string" && argument.trim()) return argument.trim();
  return raw.trim();
}

export const fundPortfolioHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "ticker", optional: false, placeholder: "ticker", description: "Fund ticker" },
  options: [],
  discovery: {
    aliases: ["NPORT"],
    limitations: ["The 25 largest holdings by reported value", "A filing over 1.5 MB is not read"],
  },
  describe: (args) => {
    const ticker = tickerFrom(args.argument, args.rawArgument);
    return ticker ? `Fund holdings for ${ticker}` : "Fund holdings";
  },
  async load(args, ctx) {
    const ticker = tickerFrom(args.argument, args.rawArgument);
    const data = await fetchFundPortfolio(ticker, ctx.signal);
    const reported = [
      ...(data.period ? [{ label: "Period", value: data.period }] : []),
      ...(data.netAssets != null ? [{ label: "Net assets", value: data.netAssets, formatted: formatNetAssets(data.netAssets) ?? undefined }] : []),
    ];
    return {
      complete: true,
      symbols: [data.ticker],
      metadata: { period: data.period, netAssets: data.netAssets },
      sections: [
        ...(reported.length > 0 ? [{ title: "Reported", entries: reported }] : []),
        {
          title: "Holdings",
          columns: [
            { key: "name", header: "Name" },
            { key: "identifier", header: "Identifier" },
            { key: "value", header: "Value", align: "right" as const, format: (value) => formatHoldingValue(typeof value === "number" ? value : null) },
            { key: "percent", header: "% of assets", align: "right" as const, format: (value) => formatAssetPercent(typeof value === "number" ? value : null) },
          ],
          rows: data.holdings.map((holding) => ({
            name: holding.name,
            identifier: holding.identifier,
            value: holding.value,
            percent: holding.percent,
          })),
        },
      ],
    };
  },
};
