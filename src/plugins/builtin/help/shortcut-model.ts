import type { CommandDef, KeyboardShortcut, PaneTemplateDef } from "../../../types/plugin";
import type { AppConfig } from "../../../types/config";
import { getPluginCommandCategory } from "../../../components/command-bar/commands/plugin/items";
import { commands as coreCommands, getCommandPrefixes } from "../../../components/command-bar/commands/registry";
import { getPaneShortcutPrefixes, getPaneTemplateDisplayLabel } from "../../../components/command-bar/pane-templates/items";
import { resolvePaneTemplateSection } from "../../pane-sections";
import { getSharedRegistry } from "../../registry";
import type { HelpShortcutEntry } from "./components";
import { formatKeybinding, resolveKeybindings } from "../../../app/keybindings";

type SharedRegistry = ReturnType<typeof getSharedRegistry>;

/** The slice of the plugin registry the essentials list reads. */
export interface EssentialCommandRegistry {
  commands?: ReadonlyMap<string, CommandDef>;
  paneTemplates?: ReadonlyMap<string, PaneTemplateDef>;
  getCommandPluginId?(commandId: string): string | undefined;
  getPaneTemplatePluginId?(templateId: string): string | undefined;
  getConfigFn?(): Pick<AppConfig, "disabledPlugins">;
}

/**
 * The commands a new user needs first, in teaching order. Labels and
 * descriptions come from whatever the command bar would run for each prefix,
 * so renaming a pane or command updates Help without editing this list.
 */
export const ESSENTIAL_COMMAND_PREFIXES = [
  "DES",
  "G",
  "CAT",
  "QQ",
  "TOP",
  "N",
  "ART",
  "PF",
  "SA",
  "ALRT",
  "PM",
  "POLL",
  "CHAT",
  "TEAM",
  "NOTE",
  "NOT",
  "LAY",
  "KEYS",
  "BIND",
  "HELP",
] as const;

export interface EssentialCommandEntry {
  id: string;
  prefixes: string[];
  label: string;
  description: string;
  /** What to put in the command bar: the prefix, plus a space when it takes an argument. */
  query: string;
}

function essentialEntry(
  id: string,
  prefixes: string[],
  label: string,
  description: string | undefined,
  takesArg: boolean,
): EssentialCommandEntry {
  const primary = prefixes[0]!;
  return {
    id,
    prefixes,
    label: label.trim(),
    description: description?.trim() || label.trim(),
    query: takesArg ? `${primary} ` : primary,
  };
}

/** Same precedence as the command bar: core commands, then plugin commands, then pane templates. */
function resolveEssentialCommand(registry: EssentialCommandRegistry | null | undefined, prefix: string, disabledPlugins: Set<string>): EssentialCommandEntry | null {
  const core = coreCommands.find((command) => getCommandPrefixes(command).includes(prefix));
  if (core) {
    return essentialEntry(`core:${core.id}`, getCommandPrefixes(core), core.label, core.description, !!core.hasArg);
  }
  if (!registry) return null;

  const pluginCommand = [...(registry.commands?.values() ?? [])].find((command) => (
    [command.shortcut ?? "", ...(command.shortcutAliases ?? [])].some((value) => value.trim().toUpperCase() === prefix)
  ));
  if (pluginCommand) {
    const pluginId = registry.getCommandPluginId?.(pluginCommand.id);
    if ((pluginId && disabledPlugins.has(pluginId)) || pluginCommand.hidden?.()) return null;
    const prefixes = [pluginCommand.shortcut ?? "", ...(pluginCommand.shortcutAliases ?? [])]
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    return essentialEntry(
      `plugin-command:${pluginCommand.id}`,
      prefixes,
      pluginCommand.label,
      pluginCommand.description,
      !!pluginCommand.shortcutArg,
    );
  }

  const template = [...(registry.paneTemplates?.values() ?? [])].find((entry) => getPaneShortcutPrefixes(entry).includes(prefix));
  if (!template) return null;
  const pluginId = registry.getPaneTemplatePluginId?.(template.id);
  if (pluginId && disabledPlugins.has(pluginId)) return null;
  return essentialEntry(
    `pane-template:${template.id}`,
    getPaneShortcutPrefixes(template),
    getPaneTemplateDisplayLabel(template),
    template.description,
    !!template.shortcut?.argKind || !!template.shortcut?.argPlaceholder,
  );
}

export function resolveEssentialCommands(registry: EssentialCommandRegistry | null | undefined): EssentialCommandEntry[] {
  const disabledPlugins = resolveDisabledPlugins(registry);
  return ESSENTIAL_COMMAND_PREFIXES.flatMap((prefix) => {
    const entry = resolveEssentialCommand(registry, prefix, disabledPlugins);
    return entry ? [entry] : [];
  });
}

export function resolveWindowTemplates(registry: SharedRegistry): HelpShortcutEntry[] {
  if (!registry || !registry.paneTemplates) return [];

  const disabledPlugins = resolveDisabledPlugins(registry);

  return [...registry.paneTemplates.values()]
    .filter((template) => template.shortcut)
    .filter((template) => {
      const pluginId = registry.getPaneTemplatePluginId?.(template.id);
      return !pluginId || !disabledPlugins.has(pluginId);
    })
    .map((template) => {
      const shortcut = template.shortcut!;
      const pluginId = registry.getPaneTemplatePluginId?.(template.id);
      return {
        id: template.id,
        badges: [
          shortcut.prefix,
          shortcut.argPlaceholder ? `<${shortcut.argPlaceholder}>` : null,
        ].filter((value): value is string => !!value),
        description: template.label,
        category: resolvePaneTemplateSection({
          templateId: template.id,
          templateCategory: template.category,
          pluginId,
        }),
      };
    })
    .sort(sortShortcutEntries);
}

function resolveDisabledPlugins(registry: Pick<EssentialCommandRegistry, "getConfigFn"> | null | undefined): Set<string> {
  try {
    return new Set(registry?.getConfigFn?.().disabledPlugins ?? []);
  } catch {
    return new Set();
  }
}

function formatPlaceholder(value: string | undefined): string | null {
  return value ? `<${value}>` : null;
}

function formatShortcutDescription(description: string | undefined): string {
  return description?.trim() || "Run command";
}

function sortShortcutEntries(left: HelpShortcutEntry, right: HelpShortcutEntry): number {
  return left.category.localeCompare(right.category)
    || left.badges.join(" ").localeCompare(right.badges.join(" "))
    || left.description.localeCompare(right.description);
}

export function resolveCommandShortcuts(registry: SharedRegistry): HelpShortcutEntry[] {
  const coreRows: HelpShortcutEntry[] = coreCommands
    .filter((command) => command.prefix.trim().length > 0)
    .map((command) => ({
      id: `core:${command.id}`,
      badges: [
        command.prefix.toUpperCase(),
        formatPlaceholder(command.argPlaceholder),
      ].filter((value): value is string => !!value),
      description: command.description,
      category: command.category,
    }));

  if (!registry || !registry.commands) return coreRows;

  const disabledPlugins = resolveDisabledPlugins(registry);
  const pluginRows = [...registry.commands.values()]
    .filter((command: CommandDef) => command.shortcut?.trim().length)
    .filter((command: CommandDef) => {
      const pluginId = registry.getCommandPluginId?.(command.id);
      if (pluginId && disabledPlugins.has(pluginId)) return false;
      return !(command.hidden?.() ?? false);
    })
    .map((command: CommandDef) => {
      return {
        id: `plugin-command:${command.id}`,
        badges: [
          command.shortcut!.toUpperCase(),
          ...(command.shortcutAliases ?? []).map((alias) => alias.trim().toUpperCase()).filter(Boolean),
          formatPlaceholder(command.shortcutArg?.placeholder),
        ].filter((value): value is string => !!value),
        description: formatShortcutDescription(command.label),
        category: getPluginCommandCategory(command),
      };
    })
    .sort(sortShortcutEntries);

  return [...coreRows, ...pluginRows];
}

function formatShortcutKey(shortcut: Pick<KeyboardShortcut, "key" | "ctrl" | "shift" | "alt">): string {
  return formatKeybinding(shortcut);
}

export function resolveGlobalShortcuts(registry: SharedRegistry): HelpShortcutEntry[] {
  if (!registry) return [];
  let config: AppConfig | undefined;
  try {
    config = registry.getConfigFn?.();
  } catch {
    return [];
  }
  if (!config) return [];
  return resolveKeybindings(config, registry.shortcuts?.values())
    .filter((shortcut) => shortcut.group === "global")
    .map((shortcut) => ({
      id: shortcut.id,
      badges: [formatKeybinding(shortcut)],
      description: formatShortcutDescription(shortcut.description),
      category: "Global",
    }));
}

export function resolvePluginShortcuts(registry: SharedRegistry): HelpShortcutEntry[] {
  if (!registry || !registry.shortcuts) return [];

  const disabledPlugins = resolveDisabledPlugins(registry);
  let config: Pick<AppConfig, "keybindings">;
  try {
    config = registry.getConfigFn?.() ?? { keybindings: {} };
  } catch {
    config = { keybindings: {} };
  }
  return resolveKeybindings(config, registry.shortcuts.values())
    .filter((shortcut) => shortcut.group === "plugin")
    .filter((shortcut) => {
      const pluginId = registry.getShortcutPluginId?.(shortcut.id);
      return !pluginId || !disabledPlugins.has(pluginId);
    })
    .map((shortcut) => {
      const pluginId = registry.getShortcutPluginId?.(shortcut.id);
      return {
        id: `plugin-shortcut:${shortcut.id}`,
        badges: [formatShortcutKey(shortcut)],
        description: formatShortcutDescription(shortcut.description),
        category: resolvePaneTemplateSection({ pluginId }),
      };
    })
    .sort(sortShortcutEntries);
}

export function groupShortcutEntries(entries: HelpShortcutEntry[]): Array<{ title: string; entries: HelpShortcutEntry[] }> {
  const groups = new Map<string, HelpShortcutEntry[]>();
  for (const entry of entries) {
    const category = entry.category || "Other";
    groups.set(category, [...(groups.get(category) ?? []), entry]);
  }
  return [...groups.entries()]
    .map(([title, groupedEntries]) => ({ title, entries: groupedEntries }))
    .sort((left, right) => left.title.localeCompare(right.title));
}
