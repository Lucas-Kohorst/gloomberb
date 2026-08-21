import type { AssistCommandDescriptor } from "../../../api-client";
import type { CommandDef, PaneTemplateDef } from "../../../types/plugin";
import type { Command } from "../commands/registry";
import { getPaneTemplateDisplayLabel } from "../pane-templates/items";
import {
  getCommandShortcutArgKind,
  getPaneShortcutArgKind,
  getPluginCommandShortcutArgKind,
  type RootShortcutArgKind,
} from "../routes/root/shortcuts";

/** Server cap on `/assist/command` inventories. */
const ASSIST_INVENTORY_LIMIT = 150;

interface AssistInventorySource {
  commands: readonly Command[];
  pluginCommands: readonly CommandDef[];
  paneTemplates: readonly PaneTemplateDef[];
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
  limit = ASSIST_INVENTORY_LIMIT,
}: AssistInventorySource): AssistCommandDescriptor[] {
  const descriptors: Array<AssistCommandDescriptor | null> = [
    ...commands.map((command) => describe(
      command.prefix,
      command.label,
      command.description,
      describeArg(getCommandShortcutArgKind(command), command.argPlaceholder),
    )),
    ...pluginCommands.map((command) => describe(
      command.shortcut ?? "",
      command.label,
      command.description,
      describeArg(getPluginCommandShortcutArgKind(command), command.shortcutArg?.placeholder),
      command.keywords,
    )),
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
