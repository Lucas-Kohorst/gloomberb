import type { MoneyMarketRow, MoneyMarketsPayload } from "../../../api-client/money-markets";
import type { CompositeAxisDomain } from "../../../components/chart/composite/types";

export const moneyMarketValue = (value: number | null, unit: MoneyMarketRow["unit"]) => value == null
  ? "--"
  : unit === "percent"
    ? `${value.toFixed(2)}%`
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: Math.abs(value) < 10 ? 3 : 1, maximumFractionDigits: Math.abs(value) < 10 ? 3 : 1 })}B`;

export const moneyMarketChange = (value: number | null, unit: MoneyMarketRow["changeUnit"]) => value == null
  ? "--"
  : `${value > 0 ? "+" : ""}${value.toFixed(unit === "usd-billions" && Math.abs(value) < 1 ? 3 : 1)}${unit === "basis-points" ? "bp" : "B"}`;

/** Decimals that keep neighbouring ticks apart. */
function spanDigits(domain: Pick<CompositeAxisDomain, "min" | "max">): number {
  const span = Math.abs(domain.max - domain.min);
  if (!Number.isFinite(span) || span >= 10) return 0;
  if (span >= 1) return 1;
  if (span >= 0.1) return 2;
  return 3;
}

function spanAxisFormatter(
  format: (value: number, digits: number) => string,
): (value: number, domain: CompositeAxisDomain) => string {
  return (value, domain) => format(value, spanDigits(domain));
}

const formatPercentAxis = spanAxisFormatter((value, digits) => `${value.toFixed(digits)}%`);
const formatBillionsAxis = spanAxisFormatter((value, digits) => (
  `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}B`
));

/** Axis labels in the board's units, with the decimals the plotted range needs. */
export function moneyMarketAxis(unit: MoneyMarketRow["unit"]): (value: number, domain: CompositeAxisDomain) => string {
  return unit === "percent" ? formatPercentAxis : formatBillionsAxis;
}

/** A move in a bill's discount yield, in basis points like the board's change column. */
export const moneyMarketRateChange = (value: number) => moneyMarketChange(value * 100, "basis-points");

export function moneyMarketNotices(data: MoneyMarketsPayload): string[] {
  const notices = [...data.rows, data.netLiquidity].flatMap((row) => row.status === "unavailable"
    ? [`${row.label}: ${(row.unavailableReason ?? "unavailable").replaceAll("-", " ")}.`]
    : row.status === "stale" ? [`${row.label}: stale, last observation ${row.asOf ?? "unknown"}.`] : []);
  if (data.billsCurve.status === "unavailable") notices.push("Bills curve: no common observation date across all four tenors.");
  else if (data.billsCurve.status === "stale") notices.push(`Bills curve: stale, last common observation ${data.billsCurve.asOf}.`);
  for (const ghost of data.billsCurve.comparisons) {
    if (!ghost.points.length) notices.push(`Bills ${ghost.period}: no common observation within seven days before ${ghost.targetDate ?? "the comparison date"}.`);
  }
  return notices;
}

export interface MoneyMarketCurvePoint {
  id: string;
  label: string;
  seriesId: string;
  x: number;
  value: number;
  asOf: string | null;
}

export interface MoneyMarketCurve {
  id: string;
  label: string;
  asOf: string | null;
  /** A year-ago curve is a different regime; the rank carries that context. */
  chartVisible: boolean;
  color?: string;
  points: MoneyMarketCurvePoint[];
}

export interface MoneyMarketCurvePalette {
  current?: string;
  ghosts: Readonly<Record<string, string>>;
}

export function moneyMarketCurves(data: MoneyMarketsPayload, palette?: MoneyMarketCurvePalette): MoneyMarketCurve[] {
  const curve = data.billsCurve;
  return [{ id: "today", label: "Latest", ...curve }, ...curve.comparisons.map((ghost) => ({ id: ghost.period, label: ghost.period, ...ghost }))]
    .filter((snapshot) => snapshot.points.length > 0)
    .map((snapshot) => ({
      id: snapshot.id,
      label: snapshot.label,
      asOf: snapshot.asOf,
      chartVisible: snapshot.id !== "1Y",
      color: snapshot.id === "today" ? palette?.current : palette?.ghosts[snapshot.id],
      points: snapshot.points.map((point) => ({
        id: point.tenor,
        label: point.tenor,
        seriesId: point.seriesId,
        x: point.maturityYears,
        value: point.value,
        asOf: snapshot.asOf,
      })),
    }));
}

export function moneyMarketRows(data: MoneyMarketsPayload, tab: string): MoneyMarketRow[] {
  return tab === "liquidity"
    ? [data.netLiquidity, ...data.rows.filter((row) => row.group === "liquidity")]
    : data.rows.filter((row) => row.group === (tab === "bills" ? "bills" : "rates"));
}

/** The backend buffer serves prior-year curve lookups, not the displayed rank window. */
export function moneyMarketHistory(row: MoneyMarketRow) {
  const { windowStart, windowEnd } = row.percentile;
  return row.history.filter((point) => (!windowStart || point.date >= windowStart) && (!windowEnd || point.date <= windowEnd));
}

/**
 * The rank window's fixings. FRED dates bank holidays with no value; no rate
 * was published those days, so charts run across them instead of breaking.
 */
export function moneyMarketObservations(row: MoneyMarketRow): Array<{ date: string; value: number }> {
  return moneyMarketHistory(row).flatMap((point) => point.value == null ? [] : [{ date: point.date, value: point.value }]);
}
