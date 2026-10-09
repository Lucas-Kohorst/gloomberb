import type {
  HeadlessPaneDefinition,
  HeadlessPaneLoadArgs,
} from "../../../types/plugin";
import {
  loadCreditBoard,
  type CreditBoardLoadResult,
  type CreditSeriesLoader,
} from "./client";

const bp = (value: unknown, signed = false) => value == null || !Number.isFinite(Number(value))
  ? "-"
  : `${signed && Number(value) > 0 ? "+" : ""}${Number(value).toFixed(1)}bp`;

const COLUMNS = [
  { key: "label", header: "Index" },
  { key: "seriesId", header: "Series" },
  { key: "oasBp", header: "OAS", align: "right" as const, format: (value: unknown) => bp(value) },
  { key: "yieldPct", header: "Yield", align: "right" as const, format: (value: unknown) => value == null || !Number.isFinite(Number(value)) ? "-" : `${Number(value).toFixed(2)}%` },
  {
    key: "dailyChangeBp",
    header: "1D",
    align: "right" as const,
    format: (value: unknown) => bp(value, true),
  },
  { key: "spreadVs10YBp", header: "Vs 10Y", align: "right" as const, format: (value: unknown) => bp(value) },
  { key: "date", header: "As of" },
];

interface CreditConditionsHeadlessDependencies {
  load(
    args: HeadlessPaneLoadArgs,
    loader: CreditSeriesLoader,
    curve: () => Promise<Array<{ maturity: string; yield: number | null }>>,
  ): Promise<CreditBoardLoadResult>;
}

const defaultDependencies: CreditConditionsHeadlessDependencies = {
  load: (_args, loader, curve) => loadCreditBoard(false, loader, curve),
};

function createCreditConditionsHeadless(
  dependencies: CreditConditionsHeadlessDependencies = defaultDependencies,
): HeadlessPaneDefinition<"rows"> {
  return {
    shape: "rows",
    argument: { kind: "none" },
    options: [],
    columns: COLUMNS,
    describe: "Credit Spreads",
    async load(args, ctx) {
      const result = await dependencies.load(
        args,
        (seriesId, options) => ctx.apiClient.getCloudFredSeries(seriesId, options),
        () => ctx.apiClient.getCloudYieldCurve(),
      );
      return {
        // The year of history feeds the pane's chart and rank, not the report rows.
        rows: [
          ...result.rows.map(({ history: _history, ...row }) => ({ ...row, yieldPct: null, spreadVs10YBp: null })),
          ...result.yields.map((row) => row.status === "available"
            ? { label: row.label, seriesId: row.seriesId, oasBp: null, yieldPct: row.yieldPct, dailyChangeBp: row.dailyChangeBp, spreadVs10YBp: row.spreadVs10YBp, date: row.date }
            : { label: row.label, seriesId: row.seriesId, oasBp: null, yieldPct: null, dailyChangeBp: null, spreadVs10YBp: null, date: null }),
        ],
        errors: result.errors,
        metadata: { stale: result.stale },
      };
    },
  };
}

export const creditConditionsHeadless = createCreditConditionsHeadless();
