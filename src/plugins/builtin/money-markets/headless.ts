import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchMoneyMarkets } from "./client";
import { moneyMarketChange, moneyMarketNotices, moneyMarketRows, moneyMarketValue } from "./model";

export const moneyMarketsHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [{
    key: "tab",
    type: "enum",
    description: "Money-market view.",
    values: [{ value: "rates" }, { value: "bills" }, { value: "liquidity" }],
    defaultValue: "rates",
  }],
  describe: "US money markets",
  async load(args) {
    const data = await fetchMoneyMarkets();
    const tab = String(args.options.tab ?? "rates");
    const rows = moneyMarketRows(data, tab);
    const errors = moneyMarketNotices(data);
    const complete = data.status === "available" && errors.length === 0;
    return {
      sections: [{
        title: "Observations",
        columns: [
          { key: "label", header: "Instrument" },
          {
            key: "value",
            header: "Level",
            align: "right",
            format: (value, row) => moneyMarketValue(value as number | null, row.unit as "percent" | "usd-billions"),
          },
          {
            key: "change",
            header: "Change",
            align: "right",
            format: (value, row) => moneyMarketChange(value as number | null, row.changeUnit as "basis-points" | "usd-billions"),
          },
          { key: "previousAsOf", header: "Versus" },
          {
            key: "percentileValue",
            header: "Pctl 1Y",
            align: "right",
            format: (value) => value == null ? "--" : Number(value).toFixed(0),
          },
          { key: "asOf", header: "As of" },
          { key: "status", header: "Status" },
        ],
        rows: rows.map(({ history: _history, ...row }) => ({ ...row, percentileValue: row.percentile.value })),
      }],
      errors,
      metadata: {
        generatedAt: data.generatedAt,
        status: data.status,
        complete,
        selectedTab: tab,
        unavailableSymbols: rows.filter((row) => row.status === "unavailable").flatMap((row) => row.sourceSeriesIds),
      },
    };
  },
};
