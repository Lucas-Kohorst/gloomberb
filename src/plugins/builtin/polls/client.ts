import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { keyedDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
import type { VoteHubPoll } from "./types";

const BASE_URL = "https://api.votehub.com";
/** VoteHub /polls can dump thousands of rows; keep a recency-sorted head. */
export const POLLS_FETCH_HEAD = 400;

const VOTEHUB_FETCH = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 12_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-polls",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

function voteHubPollTime(poll: VoteHubPoll): number {
  const value = poll.end_date ?? poll.start_date ?? poll.created_at;
  if (!value) return 0;
  const time = Date.parse(value.includes("T") ? value : `${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : 0;
}

export function parseVoteHubPollsPayload(body: unknown): VoteHubPoll[] {
  const polls = Array.isArray(body)
    ? body.filter(isVoteHubPoll)
    : body && typeof body === "object" && Array.isArray((body as { polls?: unknown }).polls)
      ? (body as { polls: unknown[] }).polls.filter(isVoteHubPoll)
      : [];
  if (polls.length <= POLLS_FETCH_HEAD) return polls;
  return polls
    .slice()
    .sort((left, right) => voteHubPollTime(right) - voteHubPollTime(left))
    .slice(0, POLLS_FETCH_HEAD);
}

function isVoteHubPoll(value: unknown): value is VoteHubPoll {
  if (!value || typeof value !== "object") return false;
  const poll = value as Record<string, unknown>;
  return typeof poll.id === "string" && typeof poll.pollster === "string" && typeof poll.subject === "string";
}

function voteHubPollsSearch(params?: { pollType?: string; subject?: string }): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(voteHubPollQuery(params))) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function buildUrl(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function voteHubPollQuery(params?: {
  pollType?: string;
  subject?: string;
}): Record<string, string | undefined> {
  const pollType = params?.pollType?.trim();
  return {
    poll_type: !pollType || pollType === "all" ? undefined : pollType,
    subject: params?.subject,
  };
}

export async function fetchVoteHubPolls(params?: {
  pollType?: string;
  subject?: string;
}): Promise<VoteHubPoll[]> {
  const url = isHostedWebClient()
    ? keyedDataUrl("votehub", "polls", voteHubPollsSearch(params))
    : buildUrl("/polls", voteHubPollQuery(params));
  return withConnectionRequest("votehub", "polls", async () => {
    const response = await VOTEHUB_FETCH.fetch(url);
    if (!response.ok) {
      throw new Error(`VoteHub request failed (${response.status})`);
    }
    return parseVoteHubPollsPayload(await response.json());
  });
}
