export interface LoanSurveySeries {
  id: string;
  name: string;
}

/** Series whose public CSV returns `observation_date,value` rows. */
export const LOAN_SURVEY_SERIES: readonly LoanSurveySeries[] = [
  { id: "DRTSCILM", name: "Large-firm C&I" },
  { id: "DRTSCLCC", name: "Credit cards" },
];

export interface LoanSurveyPoint {
  date: string;
  value: number;
}

export interface LoanSurveyHistory {
  id: string;
  name: string;
  points: LoanSurveyPoint[];
}

export interface LoanSurveyQuarter {
  date: string;
  quarter: string;
  netPercent: number;
  previous: number | null;
  change: number | null;
}

export interface LoanSurveyRow {
  id: string;
  name: string;
  date: string;
  quarter: string;
  netPercent: number;
  previous: number | null;
  change: number | null;
  recent: LoanSurveyQuarter[];
}

const RECENT_QUARTERS = 12;

export function surveyQuarter(date: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return date;
  const quarter = Math.floor((Number(match[2]) - 1) / 3) + 1;
  return quarter >= 1 && quarter <= 4 ? `${match[1]} Q${quarter}` : date;
}

function roundTenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

function quarterRow(point: LoanSurveyPoint, prior: LoanSurveyPoint | null): LoanSurveyQuarter {
  return {
    date: point.date,
    quarter: surveyQuarter(point.date),
    netPercent: point.value,
    previous: prior?.value ?? null,
    change: prior ? roundTenth(point.value - prior.value) : null,
  };
}

export function loanSurveyRows(series: readonly LoanSurveyHistory[]): LoanSurveyRow[] {
  const order = new Map(LOAN_SURVEY_SERIES.map((entry, index) => [entry.id, index]));
  return [...series]
    .sort((left, right) => (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99))
    .flatMap((entry) => {
      const points = entry.points
        .filter((point) => Number.isFinite(point.value))
        .sort((left, right) => left.date.localeCompare(right.date));
      if (points.length === 0) return [];
      const start = Math.max(0, points.length - RECENT_QUARTERS);
      const recent = points.slice(start).map((point, index) => {
        const priorIndex = start + index - 1;
        return quarterRow(point, priorIndex >= 0 ? points[priorIndex]! : null);
      }).reverse();
      const latest = recent[0]!;
      return [{
        id: entry.id,
        name: entry.name,
        date: latest.date,
        quarter: latest.quarter,
        netPercent: latest.netPercent,
        previous: latest.previous,
        change: latest.change,
        recent,
      }];
    });
}

export function surveyAsOf(rows: readonly Pick<LoanSurveyRow, "date" | "quarter">[]): string | null {
  let latest: Pick<LoanSurveyRow, "date" | "quarter"> | null = null;
  for (const row of rows) {
    if (!latest || row.date > latest.date) latest = row;
  }
  return latest?.quarter ?? null;
}

export function formatNetPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const rounded = roundTenth(value);
  return rounded.toFixed(1);
}

export function formatNetChange(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const rounded = roundTenth(value);
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}
