import { useCallback, useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import { Button, TextField } from "../../../components";
import { DialogFrame } from "../../../components/ui/frame";
import { ListView } from "../../../components/ui/list-view";
import { colors } from "../../../theme/colors";
import type { ListViewItem } from "../../../components/ui/list-view";
import { t } from "../../../i18n";
import {
  formatKeybinding,
  resetKeybinding,
  resolveKeybindings,
  setKeybinding,
  type Keybinding,
  type ResolvedKeybinding,
} from "../../../app/keybindings";
import { useDialog, useDialogKeyboard, type PromptContext } from "../../../ui/dialog";
import { useShortcut } from "../../../react/input";
import {
  useAppDispatch,
  useAppSelector,
} from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { getSharedRegistry } from "../../registry";
import type { PaneProps } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";

function KeyCaptureDialog({
  dismiss,
  resolve,
}: PromptContext<Keybinding | undefined>) {
  useDialogKeyboard((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    event.preventDefault?.();
    event.stopPropagation?.();
    if (key === "escape") {
      dismiss();
      return;
    }
    if (!key || ["control", "shift", "alt", "meta", "super"].includes(key)) return;
    resolve({
      key,
      ...(event.ctrl || event.meta || event.super ? { ctrl: true } : {}),
      ...(event.shift ? { shift: true } : {}),
      ...(event.alt ? { alt: true } : {}),
    });
  });

  return (
    <DialogFrame title={t("Press a shortcut")}>
      <Box flexDirection="column" width={42} gap={1}>
        <Text fg={colors.text}>{t("Press the new key combination.")}</Text>
        <Text fg={colors.textDim}>{t("Press Escape to cancel.")}</Text>
        <Button label={t("Cancel")} variant="secondary" onPress={dismiss} />
      </Box>
    </DialogFrame>
  );
}

function KeybindingsPane({ focused, width, height }: PaneProps) {
  const config = useAppSelector((state) => state.config);
  const dispatch = useAppDispatch();
  const dialog = useDialog();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const registry = getSharedRegistry();
  const pluginShortcuts = [...(registry?.shortcuts.values() ?? [])];
  const entries = useMemo(() => resolveKeybindings(config, pluginShortcuts), [config, pluginShortcuts]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? entries.filter((entry) => `${entry.description} ${entry.id} ${entry.group}`.toLowerCase().includes(needle))
      : entries;
  }, [entries, query]);
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  const persist = useCallback((nextConfig: typeof config) => {
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  }, [dispatch]);

  const rebind = useCallback(async (entry: ResolvedKeybinding) => {
    const binding = await dialog.prompt<Keybinding | undefined>({
      closeOnClickOutside: true,
      content: (context: unknown) => <KeyCaptureDialog {...(context as PromptContext<Keybinding | undefined>)} />,
    }).catch(() => undefined);
    if (!binding) return;
    const result = setKeybinding(config, entry.id, binding, pluginShortcuts);
    if (result.error) {
      registry?.notify({ body: t(result.error), type: "error" });
      return;
    }
    persist(result.config);
  }, [config, dialog, persist, pluginShortcuts, registry]);

  const reset = useCallback((entry: ResolvedKeybinding) => {
    persist(resetKeybinding(config, entry.id));
  }, [config, persist]);

  const resetAll = useCallback(() => {
    persist({ ...config, keybindings: {} });
  }, [config, persist]);

  const listItems = useMemo<ListViewItem[]>(() => filtered.map((entry) => ({
    id: entry.id,
    label: `${entry.group === "global" ? t("GLOBAL") : t("PLUGIN")} · ${t(entry.description)}`,
    right: formatKeybinding(entry),
  })), [filtered]);

  useShortcut((event) => {
    if (!focused || event.defaultPrevented || event.propagationStopped) return;
    if (event.name !== "enter" && event.name !== "return") return;
    const entry = filtered[safeSelectedIndex];
    if (!entry) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void rebind(entry);
  }, { enabled: focused });

  const hasOverrides = Object.keys(config.keybindings ?? {}).length > 0;
  return (
    <Box flexDirection="column" width={width} height={height} padding={1} gap={1}>
      <Box flexDirection="row" gap={1}>
        <TextField
          label={t("Search")}
          value={query}
          onChange={(value) => {
            setQuery(value);
            setSelectedIndex(0);
          }}
          placeholder={t("Search shortcuts")}
          width={Math.max(20, width - 16)}
        />
        <Button
          label={t("Reset all")}
          variant="secondary"
          disabled={!hasOverrides}
          onPress={resetAll}
        />
      </Box>
      <ListView
        items={listItems}
        selectedIndex={safeSelectedIndex}
        onSelect={setSelectedIndex}
        onActivate={(_item, index) => {
          const entry = filtered[index];
          if (entry) void rebind(entry);
        }}
        renderRow={(item, rowState, index) => {
          const entry = filtered[index]!;
          return (
            <Box flexDirection="row" justifyContent="space-between" width="100%">
              <Text fg={rowState.selected ? colors.selectedText : colors.text}>{item.label}</Text>
              <Box flexDirection="row" gap={1}>
                <Text fg={rowState.selected ? colors.selectedText : colors.textDim}>{item.right}</Text>
                <Button
                  label={t("Reset")}
                  variant="secondary"
                  disabled={!config.keybindings?.[entry.id]}
                  onPress={() => reset(entry)}
                />
              </Box>
            </Box>
          );
        }}
        selectOnHover
        scrollable
        flexGrow={1}
        emptyMessage={t("No matching shortcuts")}
        surface="plain"
      />
    </Box>
  );
}

export const keybindingsModule: PluginModule = {
  panes: [{
    id: "keybindings",
    name: t("Key Bindings"),
    component: KeybindingsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 72, height: 26 },
  }],
  paneTemplates: [{
    id: "keybindings-pane",
    paneId: "keybindings",
    label: t("Key Bindings"),
    description: t("Browse and rebind global and plugin keyboard shortcuts."),
    keywords: ["bind", "keybindings", "shortcuts", "keyboard", "rebind", "hotkeys"],
    shortcut: { prefix: "BIND", aliases: ["KB"] },
  }],
};
