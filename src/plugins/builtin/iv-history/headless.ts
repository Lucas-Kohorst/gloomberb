import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { loadIvHistory, loadIvPriceHistory, loadIvScreen, loadRealizedVolatilities, ivSymbol, type ImpliedVolatilityApi } from "./client";
import { extremeRank, formatPoints, formatStat, formatVol, verdictLabel } from "./format";
import {
  HV_WINDOWS,
  type HvWindow,
  type IvLookback,
  type IvStatRow,
  projectIvHistory,
  projectRichCheap,
  sharedReading,
  VCA_LIMIT,
  VCA_PRESETS,
} from "./model";
import { vcaUniverse } from "./universe";

const percent = (value: unknown) => typeof value === "number" ? formatVol(value) : "--";
const rankText = (value: unknown) => extremeRank(typeof value === "number" ? value : null).text;

function ivApi(client: unknown): ImpliedVolatilityApi | undefined {
  if (!client || typeof client !== "object" || !("impliedVolatility" in client)) return undefined;
  return typeof (client as ImpliedVolatilityApi).impliedVolatility === "function" ? client as ImpliedVolatilityApi : undefined;
}

export const ivHistoryHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "ticker", description: "US option underlying" },
  describe: (args) => `HIVG ${args.symbols[0] ?? ""}`,
  options: [
    { key: "lookback", type: "enum", values: [{ value: "1Y" }, { value: "2Y" }, { value: "ALL" }], defaultValue: "1Y", description: "Visible history" },
    { key: "hvWindow", type: "enum", values: HV_WINDOWS.map((window) => ({ value: String(window) })), defaultValue: "20", description: "Realized volatility window in sessions" },
  ],
  async load(args, ctx) {
    const symbol = args.symbols[0] ?? "";
    const api = ivApi(ctx.apiClient);
    const [payload, prices] = await Promise.all([
      api ? loadIvHistory(symbol, { signal: ctx.signal }, api) : loadIvHistory(symbol, { signal: ctx.signal }),
      loadIvPriceHistory({ symbol: ivSymbol(symbol) }, ctx.marketData),
    ]);
    const model = projectIvHistory(payload, prices, {
      lookback: String(args.options.lookback) as IvLookback,
      hvWindow: (Number(args.options.hvWindow) === 30 ? 30 : 20) as HvWindow,
    });
    const hvByDay = new Map(model.hv.map((point) => [point.date.getTime(), point.value]));
    const rows = model.iv30.map((point, index) => ({
      date: point.date.toISOString().slice(0, 10),
      iv30: point.value,
      iv90: model.iv90.find((entry) => entry.date.getTime() === point.date.getTime())?.value ?? null,
      hv: hvByDay.get(point.date.getTime()) ?? null,
      spread: model.spread[index]?.value ?? null,
    })).reverse();
    return {
      sections: [
        {
          title: "Statistics",
          columns: [
            { key: "label", header: "Measure" },
            { key: "value", header: "Current", format: (value, row) => formatStat(value as number | null, (row as unknown as IvStatRow).unit) },
            { key: "date", header: "As of" },
            { key: "rank", header: "Rank", format: (value) => rankText(value) },
            { key: "percentile", header: "Pctl", format: (value) => rankText(value) },
            { key: "samples", header: "Sessions" },
          ],
          rows: model.stats.map((row) => ({ ...row })),
        },
        {
          title: "Daily history",
          columns: [
            { key: "date", header: "Session" },
            ...["iv30", "iv90", "hv"].map((key) => ({ key, header: key.toUpperCase(), format: percent })),
            { key: "spread", header: "IV-HV", format: (value: unknown) => typeof value === "number" ? formatPoints(value) : "--" },
          ],
          rows,
        },
      ],
      errors: model.warnings,
      metadata: { status: payload.status, symbol: payload.symbol },
    };
  },
};

export const ivScreenHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "symbol-list", optional: true, maximum: VCA_LIMIT, description: "US option underlyings; defaults to index and sector ETFs." },
  options: [{ key: "preset", type: "enum", values: [{ value: "etfs" }, { value: "megacaps" }], defaultValue: "etfs", description: "Preset when no symbols are given" }],
  describe: "Volatility rich/cheap",
  async load(args, ctx) {
    const universe = args.symbols.length
      ? vcaUniverse("custom", args.symbols.join(","), null, [])
      : vcaUniverse(String(args.options.preset) === "megacaps" ? "megacaps" : "etfs", "", null, []);
    if (!universe.instruments.length) throw new Error(universe.error ?? "Add symbols.");
    const api = ivApi(ctx.apiClient);
    const [payload, hv] = await Promise.all([
      api
        ? loadIvScreen(universe.instruments.map((instrument) => instrument.symbol), { signal: ctx.signal }, api)
        : loadIvScreen(universe.instruments.map((instrument) => instrument.symbol), { signal: ctx.signal }),
      loadRealizedVolatilities(universe.instruments, 20, { signal: ctx.signal }, ctx.marketData),
    ]);
    const rows = projectRichCheap(payload.rows, hv).sort((a, b) => (b.percentile ?? -1) - (a.percentile ?? -1));
    const queued = rows.filter((row) => row.status === "queued").map((row) => row.symbol);
    const shared = sharedReading(rows);
    const hasSkew = rows.some((row) => row.skew != null);
    return {
      sections: [{
        title: `Rich/cheap · ${universe.label}`,
        columns: [
          { key: "symbol", header: "Symbol" },
          { key: "iv30", header: "IV30", format: percent },
          ...(shared ? [] : [{ key: "date", header: "As of" }]),
          { key: "rank", header: "IVR", format: (value: unknown) => rankText(value) },
          { key: "percentile", header: "IVP", format: (value: unknown) => rankText(value) },
          { key: "verdict", header: "Rich/Cheap", format: (value: unknown) => verdictLabel(value as never) },
          { key: "termSlope", header: "30-90", format: (value: unknown) => formatPoints(value as number | null) },
          ...(hasSkew ? [{ key: "skew", header: "25D skew", format: (value: unknown) => formatPoints(value as number | null) }] : []),
          { key: "hv", header: "HV20", format: percent },
          { key: "ivHv", header: "IV/HV", format: (value: unknown) => typeof value === "number" ? value.toFixed(2) : "--" },
        ],
        rows: rows.map((row) => ({ ...row })),
      }],
      errors: [universe.error, ...(queued.length ? [`Queued for backfill: ${queued.join(", ")}`] : [])].filter((value): value is string => !!value),
      metadata: { asOf: payload.asOf, presets: VCA_PRESETS },
    };
  },
};
