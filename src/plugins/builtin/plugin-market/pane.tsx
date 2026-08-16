import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, type InputRenderable } from "../../../ui";
import {
  Button,
  DataTableView,
  EmptyState,
  InputSearchBar,
  TextField,
  nextStackSortPreference,
  sortStackItems,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
  type StackSortPreference,
} from "../../../components";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { useAppDispatch, useAppSelector, useAppStateRef } from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions } from "../../runtime";
import { isNonToggleableBuiltinPluginId } from "../../ownership";
import { buildPluginColumns, type PluginColumn, type PluginColumnId } from "./columns";
import {
  installPluginAsync,
  isPluginManagementAvailable,
  removePluginAsync,
  scanExternalPlugins,
  updatePluginAsync,
} from "./operations";
import type { ExternalPluginEntry, PluginRow } from "./types";

function comparePluginRows(a: PluginRow, b: PluginRow, columnId: PluginColumnId): number {
  switch (columnId) {
    case "name":
      return a.name.localeCompare(b.name);
    case "description":
      return a.description.localeCompare(b.description);
    case "version":
      return a.version.localeCompare(b.version);
    case "source":
      return a.source.localeCompare(b.source);
    case "status": {
      const aRank = a.hasError ? 2 : a.enabled ? 0 : 1;
      const bRank = b.hasError ? 2 : b.enabled ? 0 : 1;
      return aRank - bRank;
    }
  }
}

function renderPluginCell(row: PluginRow, column: PluginColumn, selected: boolean): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "name":
      return { text: row.name, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "description":
      return { text: row.description || "—", color: sel ?? colors.text };
    case "version":
      return { text: row.version, color: sel ?? colors.textDim };
    case "source":
      return {
        text: row.source === "external" ? "external" : "built-in",
        color: sel ?? (row.source === "external" ? colors.borderFocused : colors.textDim),
      };
    case "status":
      if (row.hasError) return { text: "error", color: sel ?? colors.negative };
      if (!row.toggleable) return { text: "on", color: sel ?? colors.textDim };
      return {
        text: row.enabled ? "enabled" : "disabled",
        color: sel ?? (row.enabled ? colors.positive : colors.textDim),
      };
  }
}

export function PluginMarketPane({ paneId, focused, width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const { notify } = usePluginAppActions();

  const disabledPlugins = useAppSelector((state) => state.config.disabledPlugins);
  const managementAvailable = isPluginManagementAvailable();

  const columns = useMemo(() => buildPluginColumns(width), [width]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [sortPreference, setSortPreference] = useState<StackSortPreference<PluginColumnId>>({
    columnId: "name",
    direction: "asc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [installMode, setInstallMode] = useState(false);
  const [installRef, setInstallRef] = useState("");

  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [externalEntries, setExternalEntries] = useState<ExternalPluginEntry[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    setExternalEntries(scanExternalPlugins());
  }, [refreshCounter]);

  const rows = useMemo(() => {
    if (!registry) return [];
    const allPlugins = [...registry.allPlugins.values()];
    const externalDirs = new Map(externalEntries.map((e) => [e.dirName, e]));

    const registeredRows: PluginRow[] = allPlugins.map((plugin) => {
      const extEntry = externalDirs.get(plugin.id);
      const isExternal = !!extEntry;
      return {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description || "",
        version: plugin.version || "—",
        enabled: !disabledPlugins.includes(plugin.id),
        toggleable: plugin.toggleable === true && !isNonToggleableBuiltinPluginId(plugin.id),
        source: isExternal ? "external" : "built-in",
        dirName: isExternal ? plugin.id : undefined,
        hasError: extEntry?.hasError,
      };
    });

    const registeredIds = new Set(allPlugins.map((p) => p.id));
    const unregisteredRows: PluginRow[] = externalEntries
      .filter((e) => !registeredIds.has(e.dirName))
      .map((e) => ({
        id: `ext:${e.dirName}`,
        name: e.dirName,
        description: e.description,
        version: e.version,
        enabled: false,
        toggleable: false,
        source: "external" as const,
        dirName: e.dirName,
        hasError: true,
        error: e.error || "Failed to load",
      }));

    return [...registeredRows, ...unregisteredRows];
  }, [registry, disabledPlugins, externalEntries]);

  const visibleRows = useMemo(() => {
    const filtered = searchQuery
      ? rows.filter((row) => {
          const q = searchQuery.toLowerCase();
          return (
            row.name.toLowerCase().includes(q)
            || row.id.toLowerCase().includes(q)
            || row.description.toLowerCase().includes(q)
          );
        })
      : rows;
    return sortStackItems(filtered, sortPreference, comparePluginRows);
  }, [rows, searchQuery, sortPreference]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleRows.some((r) => r.id === selectedId)) {
      setSelectedId(visibleRows[0]!.id);
    }
  }, [selectedId, visibleRows]);

  const selectedRow = visibleRows.find((r) => r.id === selectedId) ?? null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((c) => c + 1);
  }, []);
  const blurSearch = useCallback(() => setSearchFocused(false), []);

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
    setError(null);
  }, []);

  const togglePlugin = useCallback((row: PluginRow) => {
    if (!row.toggleable) return;
    const isEnabled = row.enabled;
    dispatch({ type: "TOGGLE_PLUGIN", pluginId: row.id });
    const currentConfig = stateRef.current.config;
    const nextDisabled = isEnabled
      ? [...currentConfig.disabledPlugins, row.id]
      : currentConfig.disabledPlugins.filter((id) => id !== row.id);
    if (isEnabled && registry) {
      for (const pId of registry.getPluginPaneIds(row.id)) {
        registry.hidePane(pId);
      }
    }
    scheduleConfigSave({ ...currentConfig, disabledPlugins: nextDisabled });
    notify({ body: `${row.name} ${isEnabled ? "disabled" : "enabled"}`, type: "info" });
  }, [dispatch, notify, registry, stateRef]);

  const handleInstall = useCallback(async () => {
    const ref = installRef.trim();
    if (!ref) return;
    setBusy(true);
    setBusyMessage("Installing...");
    setError(null);
    try {
      const result = await installPluginAsync(ref);
      notify({ body: result.message, type: result.success ? "success" : "error" });
      if (result.success) {
        setInstallMode(false);
        setInstallRef("");
        setRefreshCounter((c) => c + 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ body: msg, type: "error" });
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  }, [installRef, notify]);

  const handleUpdate = useCallback(async (row: PluginRow) => {
    if (!row.dirName) return;
    setBusy(true);
    setBusyMessage(`Updating ${row.dirName}...`);
    setError(null);
    try {
      const result = await updatePluginAsync(row.dirName);
      notify({ body: result.message, type: result.success ? "success" : "error" });
      if (result.success) setRefreshCounter((c) => c + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ body: msg, type: "error" });
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  }, [notify]);

  const handleRemove = useCallback(async (row: PluginRow) => {
    if (!row.dirName) return;
    setBusy(true);
    setBusyMessage(`Removing ${row.dirName}...`);
    setError(null);
    try {
      const result = await removePluginAsync(row.dirName);
      notify({ body: result.message, type: result.success ? "success" : "error" });
      if (result.success) {
        if (registry && row.id.startsWith("ext:") === false) {
          const currentConfig = stateRef.current.config;
          if (!currentConfig.disabledPlugins.includes(row.id)) {
            const nextDisabled = [...currentConfig.disabledPlugins, row.id];
            scheduleConfigSave({ ...currentConfig, disabledPlugins: nextDisabled });
          }
        }
        setRefreshCounter((c) => c + 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ body: msg, type: "error" });
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  }, [notify, registry, stateRef]);

  const cancelInstall = useCallback(() => {
    setInstallMode(false);
    setInstallRef("");
  }, []);

  const enterInstallMode = useCallback(() => {
    setInstallMode(true);
    setInstallRef("");
  }, []);

  const toggleSelected = useCallback(() => {
    if (selectedRow) togglePlugin(selectedRow);
  }, [selectedRow, togglePlugin]);

  const updateSelected = useCallback(() => {
    if (selectedRow) void handleUpdate(selectedRow);
  }, [handleUpdate, selectedRow]);

  const removeSelected = useCallback(() => {
    if (selectedRow) void handleRemove(selectedRow);
  }, [handleRemove, selectedRow]);

  useShortcut((event) => {
    if (!focused || !installMode) return;
    if (event.name === "escape") {
      event.stopPropagation();
      cancelInstall();
      return;
    }
    if (event.name === "enter" || event.name === "return") {
      event.stopPropagation();
      event.preventDefault?.();
      void handleInstall();
    }
  }, { enabled: focused && installMode, allowEditable: true });

  useShortcut((event) => {
    if (!focused || installMode || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !installMode && !searchFocused });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (installMode || searchFocused) return false;
    if (isPlainKey(event, "t")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      toggleSelected();
      return true;
    }
    if (isPlainKey(event, "i")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      enterInstallMode();
      return true;
    }
    if (isPlainKey(event, "u")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      updateSelected();
      return true;
    }
    if (isPlainKey(event, "x")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      removeSelected();
      return true;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (isPlainKey(event, "s") || isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    return false;
  }, [installMode, searchFocused, toggleSelected, enterInstallMode, updateSelected, removeSelected, refresh, focusSearch]);

  const canToggle = selectedRow?.toggleable === true;
  const canUpdate = selectedRow?.source === "external" && !!selectedRow?.dirName && managementAvailable;
  const canRemove = selectedRow?.source === "external" && !!selectedRow?.dirName && managementAvailable;

  usePaneFooter(paneId, () => ({
    info: [
      ...(busy && busyMessage ? [{ id: "busy", parts: [{ text: busyMessage, tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: installMode
      ? [
          { id: "install-submit", key: "Enter", label: " install", onPress: handleInstall, disabled: busy || !installRef.trim() },
          { id: "install-cancel", key: "Esc", label: " cancel", onPress: cancelInstall },
        ]
      : [
          { id: "refresh", key: "r", label: "efresh", onPress: refresh, disabled: busy },
          { id: "search", key: "s", label: "earch", onPress: focusSearch, disabled: installMode },
          { id: "toggle", key: "t", label: "oggle", onPress: toggleSelected, disabled: !canToggle || busy },
          ...(managementAvailable
            ? [{ id: "install", key: "i", label: "nstall", onPress: enterInstallMode, disabled: busy }]
            : []),
          ...(canUpdate
            ? [{ id: "update", key: "u", label: "pdate", onPress: updateSelected, disabled: busy }]
            : []),
          ...(canRemove
            ? [{ id: "remove", key: "x", label: " remove", onPress: removeSelected, disabled: busy }]
            : []),
        ],
  }), [
    busy,
    busyMessage,
    error,
    installMode,
    handleInstall,
    cancelInstall,
    refresh,
    focusSearch,
    toggleSelected,
    enterInstallMode,
    canToggle,
    canUpdate,
    canRemove,
    updateSelected,
    removeSelected,
    installRef,
  ]);

  if (installMode) {
    const fieldWidth = Math.max(20, width - 4);
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1} flexDirection="column" gap={1}>
          <Box height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Install Plugin from GitHub</Text>
          </Box>
          <Box height={1} />
          <TextField
            label="Repo"
            value={installRef}
            focused={focused}
            width={fieldWidth}
            placeholder="user/repo or https://github.com/user/repo"
            onChange={setInstallRef}
            onSubmit={handleInstall}
          />
          <Box height={1} />
          <Box flexDirection="row" gap={2}>
            <Button label="Install" variant="primary" onPress={handleInstall} shortcut="Enter" disabled={busy || !installRef.trim()} />
            <Button label="Cancel" variant="secondary" onPress={cancelInstall} shortcut="Esc" />
          </Box>
          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.textMuted} wrapMode="word" width={Math.max(12, width - 4)}>
              Clones the repo to ~/.gloomberb/plugins/ and installs dependencies.
              Restart the app after installation to load the new plugin.
            </Text>
          </Box>
          {busy && (
            <Box height={1}>
              <Text fg={colors.borderFocused}>{busyMessage}</Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  if (!registry) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <EmptyState title="Plugin registry unavailable." />
        </Box>
      </Box>
    );
  }

  if (rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1} flexDirection="column" gap={1}>
          <EmptyState
            title="No plugins installed."
            message="Install a plugin from GitHub to extend Gloomberb."
          />
          {managementAvailable && (
            <Button label="Install plugin" variant="primary" onPress={enterInstallMode} shortcut="i" />
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<PluginRow, PluginColumn>
        focused={focused && !searchFocused}
        rootWidth={width}
        rootHeight={height}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        columns={columns}
        items={visibleRows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          const next = columnId as PluginColumnId;
          setSortPreference((current) => nextStackSortPreference(current, next, next === "name" ? "asc" : "desc"));
        }}
        getItemKey={(row) => row.id}
        renderCell={(row, column, _index, rowState) => renderPluginCell(row, column, rowState.selected)}
        onActivate={(row) => {
          if (row.toggleable) togglePlugin(row);
        }}
        onRootKeyDown={handleRootKeyDown}
        rootBefore={(
          <InputSearchBar
            value={searchQuery}
            focused={focused}
            active={searchFocused}
            width={width}
            focusToken={searchFocusToken}
            inputRef={searchInputRef}
            placeholder="name or description"
            debounceMs={80}
            onFocus={focusSearch}
            onBlur={blurSearch}
            onNavigateDown={blurSearch}
            onQueryChange={setSearchQuery}
          />
        )}
        emptyStateTitle="No plugins match your search."
        emptyStateHint="Press [s] to change your search or [i] to install a new plugin."
        showHorizontalScrollbar={false}
      />
    </Box>
  );
}
