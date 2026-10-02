import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { fetchFuturesCurve, loadFuturesCurveAsOf, type FuturesCurveClient } from "./client";
import { curveAsOfDate, curveContractMonth, normalizeCurveRoot } from "./model";

/** Percentiles read as the pane shows them, a whole rank. */
const rank = (value: number | null) => value == null ? null : Math.round(value);

function curveClient(client: unknown): FuturesCurveClient | undefined {
  if (!client || typeof client !== "object") return undefined;
  const candidate = client as Partial<FuturesCurveClient>;
  return typeof candidate.getCloudFuturesCurve === "function" && typeof candidate.getCloudFuturesCurveAsOf === "function"
    ? candidate as FuturesCurveClient
    : undefined;
}

export const futuresCurveHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle", argument: { kind: "free-text", optional: true, placeholder: "root", description: "FUT root such as CL, ES, ZN or VX. Defaults to ES." },
  // Only the pane reads the tab; the report always carries both.
  options: [{ key: "tab", description: "Curve or the full contract table.", type: "enum",
    values: [{ value: "curve" }, { value: "contracts", aliases: ["contract", "table"] }], defaultValue: "curve",
    pluginState: { pluginId: "market-overview", key: "tab" } },
  { key: "date", type: "string", settingKey: "asOfDate", description: "Past date (YYYY-MM-DD): the curve as the daily settlement archive held it, with the curves a week and a month before." }],
  describe: (args) => `Futures curve ${typeof args.argument === "string" ? args.argument || "ES" : "ES"}`,
  async load(args, ctx) {
    const input = (typeof args.argument === "string" ? args.argument : "") || "ES";
    const root = normalizeCurveRoot(input);
    if (!root) throw new Error(`Unsupported futures root: ${input}`);
    const date = curveAsOfDate(args.options.date);
    const client = curveClient(ctx.apiClient);
    const data = date
      ? client ? await loadFuturesCurveAsOf(root, date, client) : await loadFuturesCurveAsOf(root, date)
      : client ? await fetchFuturesCurve(root, client) : await fetchFuturesCurve(root);
    return {
      sections: [
        { title: "Contracts", rows: data.contracts.map((row) => ({ ...row, month: curveContractMonth(row.symbol, row.expiration), percentile: rank(row.percentile) })) },
        { title: "Front spread", rows: [{ ...data.slope, annualizedRollYield: data.slope.annualizedRollYield == null ? null : Number(data.slope.annualizedRollYield.toFixed(2)),
          percentile: rank(data.slope.percentile), rollPercentile: rank(data.slope.rollPercentile) }] },
        ...data.ghosts.map((ghost) => ({ title: `${ghost.label} same-contract history`, rows: ghost.points.map((point) => ({ ...point })) })),
      ],
      errors: data.gaps,
      metadata: { root: data.root, asOf: data.asOf, status: data.status, complete: data.status === "available", percentileBasis: "Same-contract observations within one year; actual sample start/end retained" },
    };
  },
};
