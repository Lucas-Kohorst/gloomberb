import { ApiRequestError } from "../../../api-client/errors";
import {
  getCloudSocialMentionPosts,
  getCloudSocialMentions,
  type SocialMentionDayPosts,
  type SocialMentionPost,
  type SocialMentionsPayload,
  type SocialMentionsRange,
} from "../../../api-client/social-mentions";
import type { PluginPersistence } from "../../../types/plugin";
import { withConnectionRequest } from "../connections/register";

/** Connections row for Gloom Cloud X mentions and Wikipedia views. Not the shared HTTP alias. */
export const SOCIAL_MENTIONS_CONNECTION_ID = "gloom-cloud-social-mentions";

const SOURCE_KEY = "gloom-cloud";
const SCHEMA_VERSION = 1;
const MENTIONS_POLICY = { staleMs: 15 * 60_000, expireMs: 7 * 24 * 60 * 60_000 };
// A closed day's top posts only change by a few views; keep them a week.
const POSTS_POLICY = { staleMs: 24 * 60 * 60_000, expireMs: 7 * 24 * 60 * 60_000 };

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  staleAt: number;
  expiresAt: number;
}

interface CacheLoadResult<T> {
  data: T;
  stale: boolean;
  refreshError: string | null;
  error?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `createPluginCache` is not in this tree. Persist through the plugin resource
 * store, with a session map so a load before `attach` still dedupes.
 */
function createSocialCache<T>(kind: string, policy: { staleMs: number; expireMs: number }) {
  let persistence: PluginPersistence | null = null;
  const memory = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  const remember = (key: string, value: T, fetchedAt = Date.now()): CacheEntry<T> => {
    const entry = {
      value,
      fetchedAt,
      staleAt: fetchedAt + policy.staleMs,
      expiresAt: fetchedAt + policy.expireMs,
    };
    memory.set(key, entry);
    return entry;
  };

  const read = (key: string, allowExpired: boolean): CacheEntry<T> | null => {
    const now = Date.now();
    const cached = memory.get(key);
    if (cached && (allowExpired || cached.expiresAt > now)) return cached;
    const record = persistence?.getResource<T>(kind, key, {
      sourceKey: SOURCE_KEY,
      schemaVersion: SCHEMA_VERSION,
      allowExpired,
    });
    if (!record) return null;
    if (!allowExpired && (record.expired || record.expiresAt <= now)) return null;
    return remember(key, record.value, record.fetchedAt);
  };

  const write = (key: string, value: T): void => {
    remember(key, value);
    persistence?.setResource(kind, key, value, {
      sourceKey: SOURCE_KEY,
      schemaVersion: SCHEMA_VERSION,
      cachePolicy: policy,
    });
  };

  return {
    attach(next: PluginPersistence) {
      if (persistence === next) return;
      persistence = next;
      memory.clear();
    },
    reset() {
      persistence = null;
      memory.clear();
      inflight.clear();
    },
    get(key: string, options?: { allowExpired?: boolean }): CacheLoadResult<T> | null {
      const entry = read(key, options?.allowExpired ?? false);
      if (!entry) return null;
      return { data: entry.value, stale: entry.staleAt <= Date.now(), refreshError: null };
    },
    async load(key: string, loader: () => Promise<T>, options?: { force?: boolean }): Promise<CacheLoadResult<T>> {
      const cached = read(key, true);
      const now = Date.now();
      const usable = !!cached && cached.expiresAt > now;
      if (usable && cached && !options?.force && cached.staleAt > now) {
        return { data: cached.value, stale: false, refreshError: null };
      }
      const pending = !options?.force ? inflight.get(key) : undefined;
      const run = pending ?? loader().then((value) => {
        write(key, value);
        return value;
      });
      if (!pending) inflight.set(key, run);
      try {
        const data = await run;
        return { data, stale: false, refreshError: null };
      } catch (error) {
        if (usable && cached) {
          return { data: cached.value, stale: true, refreshError: errorMessage(error), error };
        }
        throw error;
      } finally {
        if (inflight.get(key) === run) inflight.delete(key);
      }
    },
  };
}

export const socialMentionsCache = createSocialCache<SocialMentionsPayload>("social-mentions", MENTIONS_POLICY);
export const socialMentionPostsCache = createSocialCache<SocialMentionDayPosts>("social-mention-posts", POSTS_POLICY);

const day = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const count = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 0);
const stance = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;

function validPost(post: SocialMentionPost): boolean {
  return !!post && /^\d{1,24}$/.test(post.id) && day(post.day) && typeof post.author === "string" && typeof post.text === "string"
    && Number.isFinite(Date.parse(post.postedAt)) && [post.views, post.likes, post.reposts, post.replies].every(count)
    && typeof post.url === "string" && post.url.startsWith("https://x.com/") && (post.stance === null || stance(post.stance));
}

function validWikipedia(wiki: NonNullable<SocialMentionsPayload["wikipedia"]>): boolean {
  return !!wiki && (wiki.article === null || typeof wiki.article === "string") && Array.isArray(wiki.days)
    && wiki.days.every((row, i) => day(row.day) && Number.isInteger(row.views) && row.views >= 0 && (i === 0 || row.day > wiki.days[i - 1]!.day))
    && (wiki.baseline === null || (typeof wiki.baseline === "number" && wiki.baseline >= 0));
}

function validReddit(reddit: NonNullable<SocialMentionsPayload["reddit"]>): boolean {
  return !!reddit && Array.isArray(reddit.days)
    && reddit.days.every((row, i) => day(row.day) && Number.isInteger(row.mentions) && row.mentions >= 0 && (i === 0 || row.day > reddit.days[i - 1]!.day))
    && (reddit.baseline === null || (typeof reddit.baseline === "number" && reddit.baseline >= 0));
}

/** Days ascending and unique, counts whole, stances in range, posts linking to X only. */
export function validateSocialMentions(payload: SocialMentionsPayload, symbol: string, range: SocialMentionsRange): SocialMentionsPayload {
  const days = payload?.x?.days;
  if (!payload || payload.symbol !== symbol || payload.range !== range || !Array.isArray(days)
    || days.some((row, i) => !day(row.day) || !Number.isInteger(row.mentions) || row.mentions < 0 || typeof row.closed !== "boolean"
      || (i > 0 && row.day <= days[i - 1]!.day))
    || !(payload.x.baseline === null || (typeof payload.x.baseline === "number" && payload.x.baseline >= 0))
    || !Array.isArray(payload.stance) || payload.stance.some((row) => !day(row.day) || !stance(row.score) || !Number.isInteger(row.posts))
    || !Array.isArray(payload.topPosts) || !payload.topPosts.every(validPost)
    || (payload.wikipedia !== undefined && !validWikipedia(payload.wikipedia))
    || (payload.reddit !== undefined && !validReddit(payload.reddit))
    || !Array.isArray(payload.pending) || !Array.isArray(payload.warnings) || payload.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("Gloom Cloud returned invalid social mention history");
  }
  return payload;
}

export interface SocialMentionsClient {
  getCloudSocialMentions(symbol: string, range?: SocialMentionsRange): Promise<SocialMentionsPayload>;
}

const cloudClient: SocialMentionsClient = {
  getCloudSocialMentions: (symbol, range = "1y") => withConnectionRequest(
    SOCIAL_MENTIONS_CONNECTION_ID,
    "mentions",
    () => getCloudSocialMentions(symbol, range),
  ),
};

export async function fetchSocialMentions(
  symbol: string,
  range: SocialMentionsRange = "1y",
  client: SocialMentionsClient = cloudClient,
): Promise<SocialMentionsPayload> {
  try {
    return validateSocialMentions(await client.getCloudSocialMentions(symbol, range), symbol, range);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw new Error("Social mentions are not available on this Gloom Cloud server yet");
    }
    throw error;
  }
}

export interface SocialMentionsResource {
  payload: SocialMentionsPayload;
  stale: boolean;
  refreshError: string | null;
}

const cacheKey = (symbol: string, range: SocialMentionsRange) => `${range}:${symbol}`;

export function cachedSocialMentions(symbol: string, range: SocialMentionsRange): SocialMentionsResource | null {
  const cached = socialMentionsCache.get(cacheKey(symbol, range), { allowExpired: true });
  if (!cached) return null;
  try {
    return { payload: validateSocialMentions(cached.data, symbol, range), stale: false, refreshError: null };
  } catch {
    return null;
  }
}

export async function loadSocialMentions(
  symbol: string,
  range: SocialMentionsRange,
  force = false,
): Promise<SocialMentionsResource> {
  const result = await socialMentionsCache.load(
    cacheKey(symbol, range),
    () => fetchSocialMentions(symbol, range),
    { force },
  );
  if (result.error instanceof ApiRequestError && [401, 403].includes(result.error.status ?? 0)) throw result.error;
  return {
    payload: validateSocialMentions(result.data, symbol, range),
    stale: result.stale,
    refreshError: result.refreshError,
  };
}

export async function loadSocialMentionPosts(symbol: string, date: string): Promise<SocialMentionPost[]> {
  const result = await socialMentionPostsCache.load(`${symbol}:${date}`, async () => {
    const data = await withConnectionRequest(
      SOCIAL_MENTIONS_CONNECTION_ID,
      "posts",
      () => getCloudSocialMentionPosts(symbol, date),
    );
    if (data?.symbol !== symbol || data.day !== date || !Array.isArray(data.posts) || !data.posts.every(validPost)) {
      throw new Error("Gloom Cloud returned invalid social posts");
    }
    return data;
  });
  return result.data.posts;
}
