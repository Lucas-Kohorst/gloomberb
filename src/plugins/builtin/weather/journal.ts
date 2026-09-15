import type { DayWindowKind } from "./day-window";
import type { ResolutionSource } from "./resolution";

export const WEATHER_JOURNAL_STATE_KEY = "forecast-journal";
export const WEATHER_JOURNAL_SCHEMA_VERSION = 1;

export type JournalMethod = "hrrr" | "gfs" | "ifs" | "implied" | "wethr-high" | "manual";
export type JournalOutcomePrint = "cli" | "dsm" | "manual";

export interface JournalCase {
  id: string;
  stationId: string;
  date: string;
  metric: "high" | "low";
  method: JournalMethod;
  forecastF: number;
  frozenAt: number;
  window: DayWindowKind;
  source: ResolutionSource;
  outcomeF: number | null;
  outcomeAt: number | null;
  outcomePrint: JournalOutcomePrint | null;
  notes: string;
}

export interface JournalState {
  cases: JournalCase[];
}

export const EMPTY_JOURNAL: JournalState = { cases: [] };

function caseKey(entry: Pick<JournalCase, "stationId" | "date" | "metric" | "method">): string {
  return `${entry.stationId}:${entry.date}:${entry.metric}:${entry.method}`;
}

export function normalizeJournal(state: JournalState | null | undefined): JournalState {
  const cases = Array.isArray(state?.cases) ? state.cases : [];
  const seen = new Set<string>();
  const next: JournalCase[] = [];
  for (const entry of cases) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.stationId !== "string" || typeof entry.date !== "string") continue;
    if (typeof entry.forecastF !== "number" || !Number.isFinite(entry.forecastF)) continue;
    const key = caseKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(entry);
  }
  return { cases: next };
}

export function freezeJournalCase(
  state: JournalState,
  draft: Omit<JournalCase, "id" | "outcomeF" | "outcomeAt" | "outcomePrint">,
  now = Date.now(),
): JournalState | { error: string } {
  if (draft.frozenAt > now + 60_000) return { error: "Cannot freeze a forecast in the future." };
  const normalized = normalizeJournal(state);
  if (normalized.cases.some((entry) => caseKey(entry) === caseKey(draft))) {
    return { error: "That station/date/method is already frozen." };
  }
  const entry: JournalCase = {
    ...draft,
    id: caseKey(draft),
    outcomeF: null,
    outcomeAt: null,
    outcomePrint: null,
  };
  return { cases: [entry, ...normalized.cases] };
}

export function recordJournalOutcome(
  state: JournalState,
  id: string,
  outcomeF: number,
  outcomePrint: JournalOutcomePrint,
  now = Date.now(),
): JournalState | { error: string } {
  const normalized = normalizeJournal(state);
  const index = normalized.cases.findIndex((entry) => entry.id === id);
  if (index < 0) return { error: "Unknown journal case." };
  const current = normalized.cases[index]!;
  if (current.outcomeF != null) return { error: "Outcome already recorded." };
  if (now < current.frozenAt) return { error: "Outcome cannot precede the freeze." };
  const next = [...normalized.cases];
  next[index] = { ...current, outcomeF, outcomeAt: now, outcomePrint };
  return { cases: next };
}

export function journalErrorStats(state: JournalState): { samples: number; mae: number; bias: number } {
  const done = normalizeJournal(state).cases.filter((entry) => entry.outcomeF != null);
  if (done.length === 0) return { samples: 0, mae: 0, bias: 0 };
  let abs = 0;
  let signed = 0;
  for (const entry of done) {
    const error = entry.forecastF - (entry.outcomeF as number);
    abs += Math.abs(error);
    signed += error;
  }
  return { samples: done.length, mae: abs / done.length, bias: signed / done.length };
}
