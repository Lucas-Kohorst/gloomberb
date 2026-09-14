import type { PaneSettingOption } from "../../../../types/plugin";

/** Plugin id that owns the news settings in `config.pluginConfig`. */
export const NEWS_PLUGIN_ID = "news";

/** Saved as `pluginConfig.news.newsMutedSources` — the picker writes string[]. */
export const NEWS_MUTED_SOURCES_KEY = "newsMutedSources";
/** Saved as `pluginConfig.news.newsMutedKeywords` — the text field edits a comma-separated string. */
export const NEWS_MUTED_KEYWORDS_KEY = "newsMutedKeywords";

/** Guard against a runaway saved value flooding every filter pass. */
export const MAX_MUTED_KEYWORDS = 200;

function pushUnique(seen: Set<string>, values: string[], entry: string): void {
  const key = entry.toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  values.push(entry);
}

/** Muted publishers saved by the Muted Sources picker. */
export function parseNewsMutedSources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    pushUnique(seen, sources, entry.trim());
  }
  return sources;
}

/**
 * Muted keywords saved by the Muted Keywords text field. Accepts the raw
 * comma-separated string the field edits, plus a string[] for programmatic
 * writes; entries may themselves contain separators.
 */
export function parseNewsMutedKeywords(value: unknown): string[] {
  const rawEntries: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of rawEntries) {
    if (typeof raw !== "string") continue;
    for (const token of raw.split(/[,;\n]/)) {
      pushUnique(seen, keywords, token.trim());
      if (keywords.length >= MAX_MUTED_KEYWORDS) return keywords;
    }
  }
  return keywords;
}

export function readNewsMutesFromPluginConfig(
  pluginConfig: Record<string, unknown> | undefined,
): { sources: string[]; keywords: string[] } {
  return {
    sources: parseNewsMutedSources(pluginConfig?.[NEWS_MUTED_SOURCES_KEY]),
    keywords: parseNewsMutedKeywords(pluginConfig?.[NEWS_MUTED_KEYWORDS_KEY]),
  };
}

/** Cap keeps the picker usable when hundreds of feeds have loaded. */
const MAX_SOURCE_OPTIONS = 200;

/**
 * Publisher vocabulary for the Muted Sources picker: distinct `source` values
 * from recently loaded articles, plus already-muted names so a source with no
 * recent stories can still be un-muted.
 */
export function collectNewsSourceOptions(
  articles: readonly { source?: string }[],
  extraSources: readonly string[] = [],
): PaneSettingOption[] {
  const seen = new Set<string>();
  const extraKeys = new Set<string>();
  const names: string[] = [];
  for (const source of extraSources) {
    const trimmed = source.trim();
    const key = trimmed.toLowerCase();
    if (!key) continue;
    extraKeys.add(key);
    pushUnique(seen, names, trimmed);
  }
  for (const article of articles) {
    pushUnique(seen, names, (article.source ?? "").trim());
  }
  const sorted = names.sort((left, right) => left.localeCompare(right));
  const retainedExtraKeys = new Set([...extraKeys].slice(0, MAX_SOURCE_OPTIONS));
  // Keep currently-muted sources selectable before filling the rest of the
  // picker, so a muted name is not stranded behind the article cap.
  const visible = sorted.length <= MAX_SOURCE_OPTIONS
    ? sorted
    : [
      ...sorted.filter((name) => retainedExtraKeys.has(name.toLowerCase())),
      ...sorted
        .filter((name) => !retainedExtraKeys.has(name.toLowerCase()))
        .slice(0, Math.max(0, MAX_SOURCE_OPTIONS - retainedExtraKeys.size)),
    ].sort((left, right) => left.localeCompare(right));
  return visible
    .map((name) => ({ value: name, label: name }));
}
