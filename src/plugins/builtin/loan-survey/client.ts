import { httpFetch } from "../../../utils/http-transport";
import {
  LOAN_SURVEY_SERIES,
  type LoanSurveyHistory,
  type LoanSurveyPoint,
  type LoanSurveySeries,
} from "./model";

export interface LoanSurveyObservation {
  date: string;
  value: number | null;
}

export interface LoanSurveyLoad {
  series: LoanSurveyHistory[];
  errors: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function surveyCsvUrl(id: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
}

/** One series CSV. A lone `.` is a missing print. HTML is not a table. */
export function parseLoanSurveyCsv(csv: string): LoanSurveyObservation[] {
  const text = csv.replace(/^\uFEFF/, "").trim();
  if (!text || /^<!doctype html/i.test(text) || /^<html/i.test(text)) {
    throw new Error("Response was not a table");
  }
  const observations: LoanSurveyObservation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    if (!DATE_RE.test(date)) continue;
    const raw = line.slice(comma + 1).trim();
    if (!raw || raw === ".") {
      observations.push({ date, value: null });
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    observations.push({ date, value });
  }
  return observations;
}

function pointsFromCsv(csv: string): LoanSurveyPoint[] {
  return parseLoanSurveyCsv(csv).flatMap((observation) => (
    observation.value == null ? [] : [{ date: observation.date, value: observation.value }]
  ));
}

async function fetchSeries(series: LoanSurveySeries): Promise<LoanSurveyHistory | null> {
  const response = await httpFetch(surveyCsvUrl(series.id), {
    headers: {
      Accept: "text/csv,text/plain,*/*",
      // A browser-like agent stalls on this CSV. curl receives it.
      "User-Agent": "curl/8.7.1",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const points = pointsFromCsv(await response.text());
  return points.length > 0 ? { id: series.id, name: series.name, points } : null;
}

export async function fetchLoanSurvey(): Promise<LoanSurveyLoad> {
  const errors: string[] = [];
  const series: LoanSurveyHistory[] = [];
  await Promise.all(LOAN_SURVEY_SERIES.map(async (definition) => {
    try {
      const history = await fetchSeries(definition);
      if (history) series.push(history);
      else errors.push(`${definition.name} unavailable.`);
    } catch (error) {
      errors.push(error instanceof Error && error.message ? error.message : `${definition.name} unavailable.`);
    }
  }));
  const order = new Map(LOAN_SURVEY_SERIES.map((definition, index) => [definition.id, index]));
  series.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  if (series.length === 0) throw new Error(errors[0] ?? "No observations returned.");
  return { series, errors: series.length === LOAN_SURVEY_SERIES.length ? [] : errors };
}
