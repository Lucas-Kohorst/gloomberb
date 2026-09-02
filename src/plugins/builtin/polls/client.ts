import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import type { VoteHubPoll } from "./types";

const BASE_URL = "https://api.votehub.com";

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
  transport: httpFetch,
});

export function parseVoteHubPollsPayload(body: unknown): VoteHubPoll[] {
  if (Array.isArray(body)) return body.filter(isVoteHubPoll);
  if (body && typeof body === "object" && Array.isArray((body as { polls?: unknown }).polls)) {
    return (body as { polls: unknown[] }).polls.filter(isVoteHubPoll);
  }
  return [];
}

function isVoteHubPoll(value: unknown): value is VoteHubPoll {
  if (!value || typeof value !== "object") return false;
  const poll = value as Record<string, unknown>;
  return typeof poll.id === "string" && typeof poll.pollster === "string" && typeof poll.subject === "string";
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

export async function fetchVoteHubPolls(params?: {
  pollType?: string;
  subject?: string;
}): Promise<VoteHubPoll[]> {
  const url = buildUrl("/polls", {
    poll_type: params?.pollType,
    subject: params?.subject,
  });
  const response = await VOTEHUB_FETCH.fetch(url);
  if (!response.ok) {
    throw new Error(`VoteHub request failed (${response.status})`);
  }
  return parseVoteHubPollsPayload(await response.json());
}
