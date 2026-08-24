import { truncateWithEllipsis } from "../../../../utils/text-wrap";

interface ScreenerCandidate {
  symbol: string;
  exchange: string;
  reason: string;
}

export interface ParsedScreenerResponse {
  title: string | null;
  summary: string | null;
  tickers: ScreenerCandidate[];
}

export interface ValidatedScreenerResult {
  symbol: string;
  exchange: string;
  reason: string;
  resolvedName: string;
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null,
  ].filter((candidate): candidate is string => !!candidate);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next parse candidate
    }
  }
  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function deriveScreenerTitle(prompt: string): string {
  const normalized = prompt
    .split(/\s+/)
    .join(" ")
    .trim();
  return truncateWithEllipsis(normalized || "New Screener", 22);
}

export function getScreenerPromptSignature(prompt: string, providerId: string, modelId?: string | null): string {
  return JSON.stringify([providerId.trim(), modelId?.trim() || null, prompt.trim()]);
}

export function matchesScreenerPromptSignature(
  signature: string | null,
  prompt: string,
  providerId: string,
  modelId?: string | null,
): boolean {
  if (signature === getScreenerPromptSignature(prompt, providerId, modelId)) return true;
  return !modelId?.trim() && signature === JSON.stringify([providerId.trim(), prompt.trim()]);
}

export function buildScreenerPrompt({
  currentDate,
  prompt,
}: {
  currentDate: string;
  prompt: string;
}): string {
  const lines = [
    `Today is ${currentDate}.`,
    "",
    "Find public-market tickers that match this screening prompt:",
    prompt.trim(),
    "",
    "Use the available Gloomberb data tools to validate every company before submitting it.",
    "",
  ];

  lines.push(
    "Reply with ONLY a JSON object. No markdown fences. No prose before or after.",
    '{"title":"short title","summary":"one line","tickers":[{"symbol":"TSLA","exchange":"NASDAQ","reason":"why it matches"}]}',
    "Rules:",
    "- Return at most 25 unique ticker candidates.",
    "- Use uppercase symbols.",
    "- `reason` must be concise and specific.",
    "- Omit any company you cannot validate with confidence.",
  );

  return lines.join("\n");
}

function coerceTickerEntry(entry: unknown): ScreenerCandidate | null {
  if (typeof entry === "string") {
    const symbol = entry.trim().toUpperCase();
    if (!/^[A-Z]{1,5}$/.test(symbol)) return null;
    return { symbol, exchange: "", reason: "No reason provided." };
  }
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as Record<string, unknown>;
  const symbol = normalizeString(candidate.symbol || candidate.ticker).toUpperCase();
  const exchange = normalizeString(candidate.exchange).toUpperCase();
  const reason = normalizeString(candidate.reason);
  if (!symbol) return null;
  return {
    symbol,
    exchange,
    reason: reason || "No reason provided.",
  };
}

function parseTickersFromProse(raw: string): ScreenerCandidate[] {
  const tickers: ScreenerCandidate[] = [];
  const seen = new Set<string>();
  const linePattern = /(?:^|\n)\s*(?:[-*]|\d+[.)])?\s*\**([A-Z]{1,5})\**(?:\s*\(([^)]+)\))?\s*[-–—:]\s*(.+)/g;
  for (const match of raw.matchAll(linePattern)) {
    const symbol = match[1] ?? "";
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    tickers.push({
      symbol,
      exchange: (match[2] ?? "").trim().toUpperCase(),
      reason: (match[3] ?? "").trim() || "No reason provided.",
    });
  }
  return tickers.slice(0, 25);
}

export function parseScreenerResponse(raw: string): ParsedScreenerResponse {
  const parsed = tryParseJson(raw);

  if (Array.isArray(parsed)) {
    const tickers = parsed
      .map(coerceTickerEntry)
      .filter((entry): entry is ScreenerCandidate => entry != null)
      .slice(0, 25);
    if (tickers.length === 0) {
      throw new Error("AI screener returned invalid JSON.");
    }
    return { title: null, summary: null, tickers };
  }

  if (parsed && typeof parsed === "object") {
    const payload = parsed as Record<string, unknown>;
    const tickersRaw = Array.isArray(payload.tickers) ? payload.tickers : null;
    if (tickersRaw) {
      const tickers = tickersRaw
        .map(coerceTickerEntry)
        .filter((entry): entry is ScreenerCandidate => entry != null)
        .slice(0, 25);
      return {
        title: normalizeString(payload.title) || null,
        summary: normalizeString(payload.summary) || null,
        tickers,
      };
    }
  }

  const proseTickers = parseTickersFromProse(raw);
  if (proseTickers.length > 0) {
    return { title: null, summary: null, tickers: proseTickers };
  }

  throw new Error("AI screener returned invalid JSON.");
}
