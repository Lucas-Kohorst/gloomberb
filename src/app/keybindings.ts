import type { AppConfig } from "../types/config";
import type { KeyboardShortcut } from "../types/plugin";

export interface Keybinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface GlobalShortcutDefinition extends Keybinding {
  id: string;
  description: string;
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcutDefinition[] = [
  { id: "global.command-bar", key: "p", ctrl: true, description: "Open command bar" },
  { id: "global.command-bar-alternate", key: "k", ctrl: true, description: "Open command bar" },
  { id: "global.ticker-search", key: "`", description: "Open ticker search" },
  { id: "global.help", key: "/", shift: true, description: "Open help" },
  { id: "global.focus-next", key: "tab", description: "Focus next pane" },
  { id: "global.focus-previous", key: "tab", shift: true, description: "Focus previous pane" },
  { id: "global.reopen-closed-pane", key: "t", ctrl: true, shift: true, description: "Reopen closed pane" },
  { id: "global.undo-layout", key: "z", ctrl: true, description: "Undo layout change" },
  { id: "global.redo-layout", key: "y", ctrl: true, description: "Redo layout change" },
  { id: "global.redo-layout-alternate", key: "z", ctrl: true, shift: true, description: "Redo layout change" },
  { id: "global.refresh", key: "r", description: "Refresh focused ticker" },
  { id: "global.refresh-all", key: "r", shift: true, description: "Refresh all tickers" },
  { id: "global.update", key: "u", description: "Install available update" },
  { id: "global.quit", key: "q", description: "Quit terminal app" },
];

export interface ResolvedKeybinding extends Keybinding {
  id: string;
  description: string;
  group: "global" | "plugin";
}

function normalizeKey(key: unknown): string | undefined {
  if (typeof key !== "string") return undefined;
  const normalized = key.trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeKeybinding(value: unknown): Keybinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<Keybinding>;
  const key = normalizeKey(candidate.key);
  if (!key) return undefined;
  return {
    key,
    ...(candidate.ctrl === true ? { ctrl: true } : {}),
    ...(candidate.shift === true ? { shift: true } : {}),
    ...(candidate.alt === true ? { alt: true } : {}),
  };
}

export function keybindingSignature(binding: Keybinding): string {
  return [
    binding.ctrl ? "ctrl" : "",
    binding.shift ? "shift" : "",
    binding.alt ? "alt" : "",
    normalizeKey(binding.key) ?? "",
  ].join("+");
}

export function formatKeybinding(binding: Keybinding): string {
  const key = normalizeKey(binding.key) ?? "";
  const label = key.length === 1 ? key.toUpperCase() : key[0]!.toUpperCase() + key.slice(1);
  return [binding.ctrl ? "Ctrl" : null, binding.shift ? "Shift" : null, binding.alt ? "Alt" : null, label]
    .filter((part): part is string => !!part)
    .join("+");
}

export function resolveKeybindings(
  config: Pick<AppConfig, "keybindings">,
  pluginShortcuts: Iterable<KeyboardShortcut> = [],
): ResolvedKeybinding[] {
  const overrides = config.keybindings ?? {};
  const core = GLOBAL_SHORTCUTS.map((shortcut) => ({
    ...(normalizeKeybinding(overrides[shortcut.id]) ?? shortcut),
    id: shortcut.id,
    description: shortcut.description,
    group: "global" as const,
  }));
  const plugins = [...pluginShortcuts].map((shortcut) => ({
    ...(normalizeKeybinding(overrides[shortcut.id]) ?? shortcut),
    id: shortcut.id,
    description: shortcut.description,
    group: "plugin" as const,
  }));
  return [...core, ...plugins];
}

export function findKeybindingConflict(
  actionId: string,
  binding: Keybinding,
  config: Pick<AppConfig, "keybindings">,
  pluginShortcuts: Iterable<KeyboardShortcut> = [],
): string | null {
  const normalized = normalizeKeybinding(binding);
  if (!normalized) return "Choose a key.";
  if (normalized.ctrl && /^[1-9]$/.test(normalized.key)) {
    return "Ctrl+1 through Ctrl+9 are reserved for switching layouts.";
  }
  const owner = resolveKeybindings(config, pluginShortcuts)
    .find((entry) => entry.id !== actionId && keybindingSignature(entry) === keybindingSignature(normalized));
  return owner ? `${formatKeybinding(normalized)} is already assigned to ${owner.description}.` : null;
}

export function setKeybinding(
  config: AppConfig,
  actionId: string,
  binding: Keybinding,
  pluginShortcuts: Iterable<KeyboardShortcut> = [],
): { config: AppConfig; error?: string } {
  const normalized = normalizeKeybinding(binding);
  const error = normalized && findKeybindingConflict(actionId, normalized, config, pluginShortcuts);
  if (!normalized || error) return { config, error: error ?? "Choose a key." };
  return {
    config: {
      ...config,
      keybindings: { ...(config.keybindings ?? {}), [actionId]: normalized },
    },
  };
}

export function resetKeybinding(config: AppConfig, actionId: string): AppConfig {
  const { [actionId]: _removed, ...keybindings } = config.keybindings ?? {};
  return { ...config, keybindings };
}

export function matchesKeybinding(
  binding: Keybinding,
  event: Pick<Keybinding, "key" | "ctrl" | "shift" | "alt">,
): boolean {
  return keybindingSignature(binding) === keybindingSignature(event);
}
