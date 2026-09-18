import {
  ASSIST_COMMAND_INVENTORY_LIMIT,
  ASSIST_COMMAND_REQUEST_LIMIT,
  type AssistCommandDescriptor,
} from "../../../api-client/types";
import type { CommandDef, PaneTemplateDef } from "../../../types/plugin";
import type { Command } from "../commands/registry";
import { getPaneTemplateDisplayLabel } from "../pane-templates/items";
import {
  getCommandShortcutArgKind,
  getPaneShortcutArgKind,
  getPluginCommandShortcutArgKind,
  type RootShortcutArgKind,
} from "../routes/root/shortcuts";

export { ASSIST_COMMAND_INVENTORY_LIMIT, ASSIST_COMMAND_REQUEST_LIMIT };

interface AssistInventorySource {
  commands: readonly Command[];
  pluginCommands: readonly CommandDef[];
  paneTemplates: readonly PaneTemplateDef[];
  getPluginNameForCommand?: (commandId: string) => string | undefined;
  limit?: number;
}

function describeArg(
  kind: RootShortcutArgKind | null,
  placeholder: string | undefined,
): AssistCommandDescriptor["arg"] {
  if (!kind) return undefined;
  const trimmed = placeholder?.trim();
  return trimmed ? { kind, placeholder: trimmed } : { kind };
}

function describe(
  prefix: string,
  name: string,
  description: string | undefined,
  arg: AssistCommandDescriptor["arg"],
  keywords: readonly string[] = [],
): AssistCommandDescriptor | null {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const normalizedName = name.trim();
  if (!normalizedPrefix || !normalizedName) return null;
  const haystack = `${normalizedName} ${description ?? ""}`.toLowerCase();
  const extraKeywords = [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))]
    .filter((keyword) => !haystack.includes(keyword.toLowerCase()))
    .slice(0, 6);
  const keywordHint = extraKeywords.length > 0 ? ` Also: ${extraKeywords.join(", ")}.` : "";
  const normalizedDescription = `${description?.trim() ?? ""}${keywordHint}`.trim();
  return {
    prefix: normalizedPrefix,
    name: normalizedName,
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    ...(arg ? { arg } : {}),
  };
}

/**
 * Flattens the command bar's prefix language into the shape `/assist/command`
 * expects. Sources are visited in the same order the shortcut parser resolves
 * them (built-in commands, plugin commands, pane templates), so the entry kept
 * for a duplicated prefix is the one the bar would actually run. Aliases are
 * omitted: the assistant should teach one canonical prefix per command.
 */
export function buildAssistCommandInventory({
  commands,
  pluginCommands,
  paneTemplates,
  getPluginNameForCommand,
  limit = ASSIST_COMMAND_INVENTORY_LIMIT,
}: AssistInventorySource): AssistCommandDescriptor[] {
  const descriptors: Array<AssistCommandDescriptor | null> = [
    ...commands.map((command) => describe(
      command.prefix,
      command.label,
      command.description,
      describeArg(getCommandShortcutArgKind(command), command.argPlaceholder),
    )),
    ...pluginCommands.map((command) => {
      const pluginName = getPluginNameForCommand?.(command.id)?.trim();
      return describe(
        command.shortcut ?? "",
        command.label,
        command.description,
        describeArg(getPluginCommandShortcutArgKind(command), command.shortcutArg?.placeholder),
        [...(command.keywords ?? []), ...(pluginName ? [pluginName] : [])],
      );
    }),
    ...paneTemplates.map((template) => describe(
      template.shortcut?.prefix ?? "",
      getPaneTemplateDisplayLabel(template),
      template.description,
      describeArg(getPaneShortcutArgKind(template), template.shortcut?.argPlaceholder),
      template.keywords,
    )),
  ];

  const seenPrefixes = new Set<string>();
  const inventory: AssistCommandDescriptor[] = [];
  for (const descriptor of descriptors) {
    if (!descriptor || seenPrefixes.has(descriptor.prefix)) continue;
    seenPrefixes.add(descriptor.prefix);
    inventory.push(descriptor);
    if (inventory.length >= limit) break;
  }
  return inventory;
}

function assistDescriptorHaystack(descriptor: AssistCommandDescriptor): string {
  return `${descriptor.prefix} ${descriptor.name} ${descriptor.description ?? ""}`.toLowerCase();
}

function scoreAssistDescriptor(descriptor: AssistCommandDescriptor, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;
  const prefix = descriptor.prefix.toLowerCase();
  const haystack = assistDescriptorHaystack(descriptor);
  let score = 0;
  if (prefix === normalized) score += 1000;
  else if (normalized.startsWith(prefix) || prefix.startsWith(normalized.split(/\s+/)[0] ?? "")) score += 200;
  for (const token of normalized.split(/[^a-z0-9]+/).filter((part) => part.length >= 2)) {
    if (prefix === token) score += 80;
    else if (prefix.includes(token)) score += 40;
    if (haystack.includes(token)) score += 12 + token.length;
  }
  return score;
}

/**
 * Pages the in-memory Assist catalog down to the `/assist/command` payload
 * cap. Matching prefixes stay even when they were registered last; unmatched
 * descriptors fill the remainder in catalog order.
 */
export function selectAssistInventoryForQuery(
  inventory: readonly AssistCommandDescriptor[],
  query: string,
  limit = ASSIST_COMMAND_REQUEST_LIMIT,
): AssistCommandDescriptor[] {
  if (inventory.length <= limit) return [...inventory];
  const scored = inventory.map((descriptor, index) => ({
    descriptor,
    index,
    score: scoreAssistDescriptor(descriptor, query),
  }));
  const matched = scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = new Set<string>();
  const paged: AssistCommandDescriptor[] = [];
  for (const entry of matched) {
    if (paged.length >= limit) break;
    selected.add(entry.descriptor.prefix);
    paged.push(entry.descriptor);
  }
  for (const descriptor of inventory) {
    if (paged.length >= limit) break;
    if (selected.has(descriptor.prefix)) continue;
    paged.push(descriptor);
  }
  return paged;
}

const NEWS_FEED_PREFIXES = new Set(["ART", "RSS"]);

/**
 * Appends the user's enabled feed names onto article/RSS descriptors so
 * `/assist/command` can resolve queries like "adjacent article on the strait"
 * to ART instead of coming back empty.
 */
export function applyNewsFeedContextToAssistInventory(
  inventory: AssistCommandDescriptor[],
  feedNames: readonly string[],
): AssistCommandDescriptor[] {
  const names = [...new Set(feedNames.map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) return inventory;
  const listed = names.slice(0, 8).join(", ");
  const suffix = ` Enabled feeds: ${listed}.`;
  return inventory.map((descriptor) => {
    if (!NEWS_FEED_PREFIXES.has(descriptor.prefix)) return descriptor;
    if (descriptor.description?.includes("Enabled feeds:")) return descriptor;
    return {
      ...descriptor,
      description: `${descriptor.description?.trim() ?? descriptor.name}.${suffix}`.replace(/\.\./g, "."),
    };
  });
}

const CHART_SERIES_PREFIXES = new Set(["G", "CAT"]);

/**
 * Appends the chart series vocabulary and expression syntax onto the `G`
 * descriptor so `/assist/command` can map natural-language chart queries
 * ("show AAPL revenue vs MSFT revenue") onto a real `G` expression.
 */
export function applyChartSeriesContextToAssistInventory(
  inventory: AssistCommandDescriptor[],
  chartSeriesContext: string,
): AssistCommandDescriptor[] {
  if (!chartSeriesContext.trim()) return inventory;
  return inventory.map((descriptor) => {
    if (!CHART_SERIES_PREFIXES.has(descriptor.prefix)) return descriptor;
    if (descriptor.description?.includes("Chart series fields:")) return descriptor;
    const base = descriptor.description?.trim() ?? descriptor.name;
    return {
      ...descriptor,
      description: `${base}.${chartSeriesContext}`.replace(/\.\./g, "."),
    };
  });
}
