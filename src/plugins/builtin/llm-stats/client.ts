import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { resolveApiKey } from "../byok/store";
import { withConnectionRequest } from "../connections/register";
import { getSharedRegistry } from "../../registry";
import {
  ARTIFICIAL_ANALYSIS_API_BASE,
  ARTIFICIAL_ANALYSIS_ENV_VAR,
  ARTIFICIAL_ANALYSIS_SERVICE_ID,
  ARTIFICIAL_ANALYSIS_SITE,
  LLM_STATS_CONNECTION_ID,
  type AaFamily,
  type AaModelRow,
  type ArtificialAnalysisData,
} from "./types";

const CLIENT = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 1,
  timeoutMs: 15_000,
  backoffBaseMs: 800,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-artificial-analysis",
  },
  transport: httpFetch,
});

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_LANGUAGE_PAGES = 12;

const MEDIA_ENDPOINTS: ReadonlyArray<{ path: string; family: AaFamily; category: string }> = [
  { path: "/media/text-to-image/models/free", family: "image", category: "text-to-image" },
  { path: "/media/image-editing/models/free", family: "image", category: "image-editing" },
  { path: "/media/text-to-video/models/free", family: "video", category: "text-to-video" },
  { path: "/media/image-to-video/models/free", family: "video", category: "image-to-video" },
  { path: "/media/text-to-video-audio/models/free", family: "video", category: "text-to-video-audio" },
  { path: "/media/image-to-video-audio/models/free", family: "video", category: "image-to-video-audio" },
  { path: "/media/text-to-speech/models/free", family: "speech", category: "text-to-speech" },
  { path: "/media/speech-to-speech/models/free", family: "speech", category: "speech-to-speech" },
  { path: "/media/speech-to-text/models/free", family: "speech", category: "speech-to-text" },
  { path: "/media/music/instrumental/models/free", family: "music", category: "music-instrumental" },
  { path: "/media/music/with-vocals/models/free", family: "music", category: "music-vocals" },
];

let cache: { data: ArtificialAnalysisData; expiresAt: number } | null = null;
let inflight: Promise<ArtificialAnalysisData> | null = null;

export class ArtificialAnalysisAuthError extends Error {
  readonly code: "missing-key" | "unauthorized";

  constructor(code: "missing-key" | "unauthorized", message: string) {
    super(message);
    this.name = "ArtificialAnalysisAuthError";
    this.code = code;
  }
}

export function resolveArtificialAnalysisApiKey(): string | undefined {
  try {
    const registry = getSharedRegistry();
    if (registry) {
      const stored = resolveApiKey(registry.getConfigFn(), ARTIFICIAL_ANALYSIS_SERVICE_ID)?.trim();
      if (stored) return stored;
    }
  } catch {
    // Registry is not always installed in tests or headless loaders.
  }
  const env = process.env[ARTIFICIAL_ANALYSIS_ENV_VAR]?.trim();
  return env || undefined;
}

export function clearArtificialAnalysisCache(): void {
  cache = null;
  inflight = null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedNum(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const direct = num(record[key]);
    if (direct != null) return direct;
  }
  return null;
}

function creator(record: Record<string, unknown>): { name: string; slug: string } {
  const nested = asRecord(record.model_creator);
  const name = str(nested?.name) ?? str(nested?.slug) ?? str(record.organization) ?? "—";
  const slug = str(nested?.slug) ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { name, slug };
}

function slugFor(record: Record<string, unknown>, name: string, id: string): string {
  return str(record.slug) ?? str(record.id) ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || id);
}

function modelUrl(slug: string, family: AaFamily): string {
  if (family === "language") return `${ARTIFICIAL_ANALYSIS_SITE}/models/${slug}`;
  if (family === "image") return `${ARTIFICIAL_ANALYSIS_SITE}/text-to-image/models/${slug}`;
  if (family === "video") return `${ARTIFICIAL_ANALYSIS_SITE}/text-to-video/models/${slug}`;
  if (family === "speech") return `${ARTIFICIAL_ANALYSIS_SITE}/speech-to-text/models/${slug}`;
  return `${ARTIFICIAL_ANALYSIS_SITE}/models/${slug}`;
}

function parseLanguageRow(value: unknown): AaModelRow | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = str(record.name);
  const id = str(record.id) ?? str(record.slug);
  if (!name || !id) return null;
  const owner = creator(record);
  const slug = slugFor(record, name, id);
  const evaluations = asRecord(record.evaluations);
  const pricing = asRecord(record.pricing);
  const performance = asRecord(record.performance);
  return {
    id,
    slug,
    name,
    creator: owner.name,
    creatorSlug: owner.slug,
    family: "language",
    category: "language",
    releaseDate: str(record.release_date),
    url: modelUrl(slug, "language"),
    intelligence: nestedNum(evaluations, ["artificial_analysis_intelligence_index"]),
    coding: nestedNum(evaluations, ["artificial_analysis_coding_index"]),
    agentic: nestedNum(evaluations, ["artificial_analysis_agentic_index"]),
    speed: nestedNum(performance, ["median_output_tokens_per_second", "output_tokens_per_second"]),
    ttftSeconds: nestedNum(performance, [
      "median_time_to_first_token_seconds",
      "median_time_to_first_token",
      "time_to_first_token",
    ]),
    e2eSeconds: nestedNum(performance, [
      "median_end_to_end_response_time_seconds",
      "median_end_to_end_response_time",
      "end_to_end_response_time",
    ]),
    inputPrice: nestedNum(pricing, ["price_1m_input_tokens", "input_price", "price_per_1m_input_tokens"]),
    outputPrice: nestedNum(pricing, ["price_1m_output_tokens", "output_price", "price_per_1m_output_tokens"]),
    elo: null,
    ci95: null,
    bba: null,
    fdb: null,
    tau: null,
    wer: null,
  };
}

function parseMediaRow(value: unknown, family: AaFamily, category: string): AaModelRow | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = str(record.name);
  const id = str(record.id) ?? str(record.slug);
  if (!name || !id) return null;
  const owner = creator(record);
  const slug = slugFor(record, name, id);
  return {
    id: `${category}:${id}`,
    slug,
    name,
    creator: owner.name,
    creatorSlug: owner.slug,
    family,
    category,
    releaseDate: str(record.release_date),
    url: modelUrl(slug, family),
    intelligence: null,
    coding: null,
    agentic: null,
    speed: null,
    ttftSeconds: null,
    e2eSeconds: null,
    inputPrice: nestedNum(record, ["price_per_1k_images", "price_per_minute", "price_per_1m_characters"]),
    outputPrice: null,
    elo: num(record.elo),
    ci95: num(record.ci_95),
    bba: num(record.bba_score),
    fdb: num(record.fdb_score),
    tau: num(record.tau_voice_score),
    wer: num(record.aa_wer_index),
  };
}

function envelopeData(body: unknown): unknown[] {
  const record = asRecord(body);
  if (Array.isArray(body)) return body;
  if (!record) return [];
  return Array.isArray(record.data) ? record.data : [];
}

function envelopeMeta(body: unknown): {
  tier: string | null;
  intelligenceIndexVersion: number | null;
  hasMore: boolean;
} {
  const record = asRecord(body);
  const pagination = asRecord(record?.pagination);
  return {
    tier: str(record?.tier),
    intelligenceIndexVersion: num(record?.intelligence_index_version),
    hasMore: pagination?.has_more === true,
  };
}

async function aaFetch(path: string, apiKey: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  return CLIENT.fetch(`${ARTIFICIAL_ANALYSIS_API_BASE}${path}`, { headers });
}

function throwForStatus(response: Response): void {
  if (response.status === 401) {
    throw new ArtificialAnalysisAuthError("unauthorized", "Add an Artificial Analysis API key.");
  }
  if (!response.ok && response.status !== 403) {
    throw new Error(`Artificial Analysis request failed (${response.status})`);
  }
}

async function fetchLanguageModels(apiKey: string | undefined): Promise<{
  rows: AaModelRow[];
  tier: string | null;
  intelligenceIndexVersion: number | null;
}> {
  const rows: AaModelRow[] = [];
  let tier: string | null = null;
  let intelligenceIndexVersion: number | null = null;
  for (let page = 1; page <= MAX_LANGUAGE_PAGES; page += 1) {
    const response = await aaFetch(`/language/models/free?page=${page}`, apiKey);
    throwForStatus(response);
    if (response.status === 403) break;
    const body: unknown = await response.json();
    const meta = envelopeMeta(body);
    tier ??= meta.tier;
    intelligenceIndexVersion ??= meta.intelligenceIndexVersion;
    for (const item of envelopeData(body)) {
      const row = parseLanguageRow(item);
      if (row) rows.push(row);
    }
    if (!meta.hasMore) break;
  }
  return { rows, tier, intelligenceIndexVersion };
}

async function fetchMediaModels(apiKey: string | undefined): Promise<AaModelRow[]> {
  const settled = await Promise.allSettled(
    MEDIA_ENDPOINTS.map(async (endpoint) => {
      const response = await aaFetch(endpoint.path, apiKey);
      throwForStatus(response);
      if (!response.ok) return [] as AaModelRow[];
      const body: unknown = await response.json();
      return envelopeData(body).flatMap((item) => {
        const row = parseMediaRow(item, endpoint.family, endpoint.category);
        return row ? [row] : [];
      });
    }),
  );
  const rows: AaModelRow[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") rows.push(...result.value);
    else if (result.reason instanceof ArtificialAnalysisAuthError) throw result.reason;
  }
  return rows;
}

async function loadArtificialAnalysisData(): Promise<ArtificialAnalysisData> {
  const apiKey = resolveArtificialAnalysisApiKey();
  return withConnectionRequest(LLM_STATS_CONNECTION_ID, "models", async () => {
    const language = await fetchLanguageModels(apiKey);
    const media = await fetchMediaModels(apiKey);
    const seen = new Set<string>();
    const rows: AaModelRow[] = [];
    for (const row of [...language.rows, ...media]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return {
      rows,
      tier: language.tier,
      intelligenceIndexVersion: language.intelligenceIndexVersion,
      fetchedAt: Date.now(),
    };
  });
}

export async function fetchArtificialAnalysisData(options?: {
  force?: boolean;
}): Promise<ArtificialAnalysisData> {
  if (!options?.force && cache && cache.expiresAt > Date.now()) return cache.data;
  if (inflight) return inflight;
  inflight = loadArtificialAnalysisData()
    .then((data) => {
      cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** @deprecated Use {@link fetchArtificialAnalysisData}. */
export const fetchLlmStatsData = fetchArtificialAnalysisData;
