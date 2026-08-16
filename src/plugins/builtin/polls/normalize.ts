import type { PollRow, VoteHubPoll, VoteHubPollAnswer } from "./types";

const POLL_TYPE_LABELS: Record<string, string> = {
  approval: "Approval",
  favorability: "Favorability",
  "generic-ballot": "Generic",
  "us-senator": "Senate",
  governor: "Governor",
  "us-representative": "House",
  mayor: "Mayor",
  "attorney-general": "AG",
  "presidential-primary": "Primary",
  "proposition-50": "Prop",
};

const POPULATION_LABELS: Record<string, string> = {
  a: "A",
  rv: "RV",
  lv: "LV",
};

export function pollTypeLabel(pollType: string): string {
  return POLL_TYPE_LABELS[pollType] ?? pollType.replace(/-/g, " ");
}

export function populationLabel(population: string | null | undefined): string {
  if (!population) return "—";
  return POPULATION_LABELS[population.toLowerCase()] ?? population.toUpperCase();
}

export function parseSampleSize(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatPollDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function sortedAnswers(answers: VoteHubPollAnswer[] | undefined): VoteHubPollAnswer[] {
  return [...(answers ?? [])]
    .filter((answer) => typeof answer.choice === "string" && Number.isFinite(answer.pct))
    .sort((left, right) => right.pct - left.pct);
}

export function summarizeAnswers(answers: VoteHubPollAnswer[] | undefined): {
  result: string;
  lead: number | null;
  leadChoice: string | null;
} {
  const ranked = sortedAnswers(answers);
  const first = ranked[0];
  const second = ranked[1];
  if (!first) return { result: "—", lead: null, leadChoice: null };
  if (!second) {
    return {
      result: `${first.choice} ${formatPct(first.pct)}`,
      lead: first.pct,
      leadChoice: first.choice,
    };
  }
  const lead = first.pct - second.pct;
  return {
    result: `${shortChoice(first.choice)} ${formatPct(first.pct)}  ${shortChoice(second.choice)} ${formatPct(second.pct)}`,
    lead,
    leadChoice: first.choice,
  };
}

function shortChoice(choice: string): string {
  const trimmed = choice.trim();
  if (trimmed.length <= 10) return trimmed;
  return trimmed.slice(0, 9);
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function normalizeVoteHubPoll(poll: VoteHubPoll): PollRow {
  const summary = summarizeAnswers(poll.answers);
  return {
    id: poll.id,
    subject: poll.subject,
    pollType: poll.poll_type,
    pollTypeLabel: pollTypeLabel(poll.poll_type),
    pollster: poll.pollster,
    population: populationLabel(poll.population),
    sampleSize: parseSampleSize(poll.sample_size),
    startDate: poll.start_date,
    endDate: poll.end_date,
    result: summary.result,
    lead: summary.lead,
    leadChoice: summary.leadChoice,
    url: poll.url,
    sponsors: Array.isArray(poll.sponsors) ? poll.sponsors.filter((sponsor) => typeof sponsor === "string") : [],
    partisan: typeof poll.partisan === "string" ? poll.partisan : null,
    internal: poll.internal === true,
    answers: sortedAnswers(poll.answers),
  };
}

export type PollSortColumnId = "date" | "subject" | "pollster" | "pop" | "result";

export interface PollSortPreference {
  columnId: PollSortColumnId;
  direction: "asc" | "desc";
}

export const DEFAULT_POLL_SORT: PollSortPreference = { columnId: "date", direction: "desc" };

export function comparePollRows(
  left: PollRow,
  right: PollRow,
  columnId: PollSortColumnId,
): number {
  switch (columnId) {
    case "date":
      return dateValue(left.endDate ?? left.startDate) - dateValue(right.endDate ?? right.startDate);
    case "subject":
      return left.subject.localeCompare(right.subject);
    case "pollster":
      return left.pollster.localeCompare(right.pollster);
    case "pop":
      return left.population.localeCompare(right.population);
    case "result":
      return (left.lead ?? Number.NEGATIVE_INFINITY) - (right.lead ?? Number.NEGATIVE_INFINITY);
  }
}

export function sortPollRows(
  rows: PollRow[],
  preference: PollSortPreference = DEFAULT_POLL_SORT,
): PollRow[] {
  const sign = preference.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const primary = comparePollRows(left, right, preference.columnId);
    if (primary !== 0) return sign * primary;
    return left.subject.localeCompare(right.subject);
  });
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? time : 0;
}
