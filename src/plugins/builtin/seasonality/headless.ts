import type { HeadlessPaneDefinition } from "../../../types/plugin";
import type { InstrumentRef } from "../../../market-data/request-types";
import { parsePublicTickerKey } from "../../../utils/exchanges";
import { loadSeasonalityHistory } from "./client";
import { MONTH_LABELS, projectSeasonality } from "./model";

const percent = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "--";

function instrumentForSymbol(symbol: string): InstrumentRef {
  const parsed = parsePublicTickerKey(symbol);
  return { symbol: parsed.symbol, exchange: parsed.exchange ?? "" };
}

export const seasonalityHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "ticker", description: "Ticker" },
  describe: (args) => `SEAS ${args.symbols[0] ?? ""}`,
  options: [
    {
      key: "tab",
      type: "enum",
      values: [{ value: "returns" }, { value: "overlay" }],
      defaultValue: "returns",
      description: "Initial view",
      pluginState: { pluginId: "ticker-research", key: "activeTabId" },
    },
    {
      key: "lookbackYears",
      type: "integer",
      minimum: 1,
      maximum: 30,
      defaultValue: 10,
      description: "Calendar years, the current one included",
    },
  ],
  async load(args, ctx) {
    const symbol = args.symbols[0];
    if (!symbol) {
      return { sections: [], errors: ["Ticker required"] };
    }
    const instrument = instrumentForSymbol(symbol);
    const history = await loadSeasonalityHistory({ instrument, signal: ctx.signal }, ctx.marketData);
    ctx.signal.throwIfAborted();
    const model = projectSeasonality(history.history, {
      symbol: instrument.symbol,
      lookbackYears: Number(args.options.lookbackYears) || 10,
    });
    const monthColumns = MONTH_LABELS.map((label, month) => ({ key: `m${month}`, header: label, format: percent }));
    return {
      sections: [
        {
          title: "By month",
          columns: [
            { key: "month", header: "Month" },
            { key: "mean", header: "Avg", format: percent },
            { key: "median", header: "Median", format: percent },
            { key: "hitRate", header: "Up", format: percent },
            { key: "count", header: "Years" },
          ],
          rows: model.months.map((stat) => ({ ...stat, month: MONTH_LABELS[stat.month] })),
        },
        {
          title: "Monthly returns",
          columns: [{ key: "year", header: "Year" }, ...monthColumns, { key: "total", header: "Year", format: percent }],
          rows: model.years.map((year) => ({
            year: year.year,
            total: year.total,
            ...Object.fromEntries(year.months.map((value, month) => [`m${month}`, value])),
          })),
        },
      ],
      errors: history.error ? [history.error] : [],
      metadata: {
        unit: "decimal return, local-price close to close",
        asOf: model.asOf?.toISOString() ?? null,
        stale: history.stale,
        fetchedAt: history.fetchedAt,
        averagePath: model.averagePath,
        complete: !history.stale && !history.error && model.years.length > 0,
        unavailableSymbols: model.years.length ? [] : [instrument.symbol],
      },
    };
  },
};
