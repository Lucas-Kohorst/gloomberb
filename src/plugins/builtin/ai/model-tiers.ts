/**
 * Model speed/cost classification for the AI model picker.
 *
 * Tiers are derived from model id patterns with a curated override map for
 * ids that don't match the heuristics cleanly. The classification powers the
 * "Fast / Balanced / Powerful" badges shown next to each model option and the
 * speed-vs-quality default selection per AI feature.
 */

export type ModelTier = "fast" | "balanced" | "powerful";

export const MODEL_TIER_ORDER: readonly ModelTier[] = ["fast", "balanced", "powerful"];

export interface ModelTierMeta {
  tier: ModelTier;
  label: string;
  /** Short badge shown inline next to a model option. */
  badge: string;
  description: string;
}

const TIER_META: Readonly<Record<ModelTier, ModelTierMeta>> = {
  fast: {
    tier: "fast",
    label: "Fast",
    badge: "Fast",
    description: "Fast and inexpensive. Best for high-volume structured work like screening.",
  },
  balanced: {
    tier: "balanced",
    label: "Balanced",
    badge: "Balanced",
    description: "A capable everyday model. Good default for most questions.",
  },
  powerful: {
    tier: "powerful",
    label: "Powerful",
    badge: "Powerful",
    description: "Top-tier reasoning. Best for deep analysis and complex agent tasks.",
  },
};

/**
 * Curated tier overrides for ids whose naming does not match the pattern
 * heuristics below. Keys are matched case-insensitively against the full id
 * and against the segment after the last `/` (OpenRouter style).
 */
const CURATED_TIERS: Readonly<Record<string, ModelTier>> = {
  // Anthropic
  "claude-haiku-4-5": "fast",
  "claude-haiku-4-5-20251001": "fast",
  "claude-sonnet-4-5": "balanced",
  "claude-sonnet-4-5-20250929": "balanced",
  "claude-sonnet-4-6": "balanced",
  "claude-sonnet-5": "balanced",
  "claude-fable-5": "balanced",
  "claude-opus-4-1": "powerful",
  "claude-opus-4-1-20250805": "powerful",
  "claude-opus-4-5": "powerful",
  "claude-opus-4-5-20251101": "powerful",
  "claude-opus-4-6": "powerful",
  "claude-opus-4-7": "powerful",
  "claude-opus-4-8": "powerful",
  // OpenAI
  "gpt-4o-mini": "fast",
  "gpt-4.1-mini": "fast",
  "gpt-4.1-nano": "fast",
  "gpt-5-nano": "fast",
  "gpt-5-mini": "fast",
  "gpt-5.4-mini": "fast",
  "gpt-5.4-nano": "fast",
  "gpt-4o": "balanced",
  "gpt-4.1": "balanced",
  "gpt-5": "balanced",
  "gpt-5.1": "balanced",
  "gpt-5.2": "balanced",
  "gpt-5.4": "balanced",
  "gpt-5.5": "balanced",
  "gpt-5.6-luna": "balanced",
  "gpt-5.6-sol": "powerful",
  "gpt-5.6-terra": "powerful",
  "gpt-5-pro": "powerful",
  "gpt-5.1-codex-max": "powerful",
  "gpt-5.2-pro": "powerful",
  "gpt-5.4-pro": "powerful",
  "gpt-5.5-pro": "powerful",
  "o1": "powerful",
  "o1-pro": "powerful",
  "o3": "powerful",
  "o3-pro": "powerful",
  "o3-deep-research": "powerful",
  "o4-mini-deep-research": "powerful",
  // Google
  "gemini-2.0-flash-lite": "fast",
  "gemini-2.5-flash-lite": "fast",
  "gemini-3.1-flash-lite": "fast",
  "gemini-3.5-flash-lite": "fast",
  "gemini-flash-lite-latest": "fast",
  "gemini-2.0-flash": "fast",
  "gemini-2.5-flash": "fast",
  "gemini-3-flash-preview": "fast",
  "gemini-3.5-flash": "fast",
  "gemini-3.6-flash": "fast",
  "gemini-flash-latest": "fast",
  "gemini-2.5-pro": "powerful",
  "gemini-3-pro-preview": "powerful",
  "gemini-3.1-pro-preview": "powerful",
  // xAI
  "grok-4.3": "balanced",
  "grok-4.5": "powerful",
};

const FAST_PATTERNS: readonly RegExp[] = [
  /(^|[-/])haiku([-/]|$)/i,
  /(^|[-/])mini([-/]|$)/i,
  /(^|[-/])nano([-/]|$)/i,
  /(^|[-/])micro([-/]|$)/i,
  /(^|[-/])lite([-/]|$)/i,
  /(^|[-/])flash([-/]|$)/i,
  /(^|[-/])spark([-/]|$)/i,
  /(^|[-/])air([-/]|$)/i,
  /(^|[-/])edge([-/]|$)/i,
];

const POWERFUL_PATTERNS: readonly RegExp[] = [
  /(^|[-/])opus([-/]|$)/i,
  /(^|[-/])pro([-/]|$)/i,
  /(^|[-/])terra([-/]|$)/i,
  /(^|[-/])sol([-/]|$)/i,
  /(^|[-/])max([-/]|$)/i,
  /(^|[-/])ultra([-/]|$)/i,
  /(^|[-/])deep-research([-/]|$)/i,
];

function lastSegment(modelId: string): string {
  const slashIndex = modelId.lastIndexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

export function classifyModelTier(modelId: string): ModelTier {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return "balanced";
  const curated = CURATED_TIERS[normalized] ?? CURATED_TIERS[lastSegment(normalized)];
  if (curated) return curated;
  if (POWERFUL_PATTERNS.some((pattern) => pattern.test(normalized))) return "powerful";
  if (FAST_PATTERNS.some((pattern) => pattern.test(normalized))) return "fast";
  return "balanced";
}

export function getModelTierMeta(tier: ModelTier): ModelTierMeta {
  return TIER_META[tier];
}

export function getModelTierMetaForId(modelId: string): ModelTierMeta {
  return getModelTierMeta(classifyModelTier(modelId));
}

export function getModelTierLabel(modelId: string): string {
  return getModelTierMetaForId(modelId).label;
}

export function getModelTierBadge(modelId: string): string {
  return getModelTierMetaForId(modelId).badge;
}

export function isFastModel(modelId: string): boolean {
  return classifyModelTier(modelId) === "fast";
}

export function isPowerfulModel(modelId: string): boolean {
  return classifyModelTier(modelId) === "powerful";
}

/**
 * Returns the model id from `candidates` that best matches the desired tier.
 * Falls back to the first candidate when no tier match is found.
 */
export function pickModelByTier(
  candidates: readonly string[],
  tier: ModelTier,
): string | null {
  if (candidates.length === 0) return null;
  const match = candidates.find((candidate) => classifyModelTier(candidate) === tier);
  if (match) return match;
  // Degrade gracefully: fast → balanced → powerful, powerful → balanced → fast.
  const fallbackOrder: Record<ModelTier, readonly ModelTier[]> = {
    fast: ["balanced", "powerful"],
    balanced: ["fast", "powerful"],
    powerful: ["balanced", "fast"],
  };
  for (const fallbackTier of fallbackOrder[tier]) {
    const fallback = candidates.find((candidate) => classifyModelTier(candidate) === fallbackTier);
    if (fallback) return fallback;
  }
  return candidates[0] ?? null;
}
