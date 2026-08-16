export const POLLS_PLUGIN_ID = "polls";
export const POLLS_PANE_ID = "polls";

export interface VoteHubPollAnswer {
  choice: string;
  pct: number;
}

export interface VoteHubPoll {
  id: string;
  poll_type: string;
  sample_size: number | string | null;
  population: string | null;
  url: string | null;
  created_at: string | null;
  start_date: string | null;
  end_date: string | null;
  pollster: string;
  answers: VoteHubPollAnswer[];
  seat_name: string | null;
  sponsors: string[];
  internal: boolean | null;
  partisan: string | null;
  subject: string;
}

export interface PollRow {
  id: string;
  subject: string;
  pollType: string;
  pollTypeLabel: string;
  pollster: string;
  population: string;
  sampleSize: number | null;
  marginOfError: number | null;
  startDate: string | null;
  endDate: string | null;
  result: string;
  lead: number | null;
  leadChoice: string | null;
  url: string | null;
  sponsors: string[];
  partisan: string | null;
  internal: boolean;
  answers: VoteHubPollAnswer[];
}

export type PollTabId =
  | "approval"
  | "favorability"
  | "generic-ballot"
  | "us-senator"
  | "governor"
  | "us-representative";

export type PollDetailTab = "overview" | "trend" | "pollsters";

export interface PollTrendPoint {
  date: string;
  value: number;
  pollster: string;
}

export interface PollsterAverage {
  pollster: string;
  count: number;
  avgPct: number;
  totalSample: number;
  lastDate: string | null;
}

export interface PollAverageSummary {
  choice: string;
  avgPct: number;
  pollCount: number;
  totalSample: number;
}
