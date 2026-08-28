import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  nextStackSortPreference,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
  type StackSortPreference,
} from "../../../components";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { isPlainKey } from "../../../utils/keyboard";
import { useAppSelector } from "../../../state/app/context";
import { getSharedRegistry } from "../../registry";
import { isNonToggleableBuiltinPluginId, isReservedBuiltinPluginId } from "../../ownership";
import { getPluginsDir } from "../../loader";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { buildInspectorColumns, type InspectorColumn, type InspectorColumnId } from "./columns";
import type { InspectorRow, InspectorSource, InspectorStatus, PluginDetailItem } from "./types";

function isNativeRuntime(): boolean {
  return typeof Bun !== "undefined" && typeof Bun.spawn === "function";
}

function getExternalPluginDirs(): Set<string> {
  if (!isNativeRuntime()) return new Set();
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) return new Set();
  return new Set(
    readdirSync(pluginsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
}

function buildInspectorRows(
  registry: ReturnType<typeof getSharedRegistry>,
  disabledPlugins: readonly string[],
  externalDirs: Set<string>,
): InspectorRow[] {
  if (!registry) return [];
  const rows: InspectorRow[] = [];

  for (const plugin of registry.allPlugins.values()) {
    const isExternal = externalDirs.has(plugin.id);
    const source: InspectorSource = isExternal ? "external" : "built-in";
    const isNonToggleable = isNonToggleableBuiltinPluginId(plugin.id);
    const toggleable = plugin.toggleable === true && !isNonToggleable;
    let status: InspectorStatus;
    if (!toggleable) {
      status = "on";
    } else if (disabledPlugins.includes(plugin.id)) {
      status = "disabled";
    } else {
      status = "enabled";
    }
    rows.push({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version || "—",
      source,
      status,
      description: plugin.description || "",
      toggleable,
      path: isExternal ? join(getPluginsDir(), plugin.id) : undefined,
    });
  }

  // Show external plugins that failed to load (not in registry)
  for (const dirName of externalDirs) {
    if (registry.allPlugins.has(dirName)) continue;
    rows.push({
      id: dirName,
      name: dirName,
      version: "—",
      source: "external",
      status: "error",
      description: "Failed to load",
      toggleable: false,
      path: join(getPluginsDir(), dirName),
      hasError: true,
    });
  }

  return rows;
}

function compareInspectorRows(a: InspectorRow, b: InspectorRow, columnId: InspectorColumnId): number {
  switch (columnId) {
    case "id":
      return a.id.localeCompare(b.id);
    case "name":
      return a.name.localeCompare(b.name);
    case "version":
      return a.version.localeCompare(b.version);
    case "source":
      return a.source.localeCompare(b.source);
    case "status": {
      const rank = (row: InspectorRow) => {
        if (row.hasError) return 3;
        if (row.status === "disabled") return 2;
        if (row.status === "on") return 1;
        return 0;
      };
      return rank(a) - rank(b);
    }
  }
}

function renderInspectorCell(row: InspectorRow, column: InspectorColumn, selected: boolean): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "id":
      return { text: row.id, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "name":
      return { text: row.name, color: sel ?? colors.text };
    case "version":
      return { text: row.version, color: sel ?? colors.textDim };
    case "source":
      return {
        text: row.source,
        color: sel ?? (row.source === "built-in" ? colors.textDim : colors.borderFocused),
      };
    case "status":
      if (row.hasError) return { text: "error", color: sel ?? colors.negative };
      if (row.status === "on") return { text: "on", color: sel ?? colors.textDim };
      return {
        text: row.status,
        color: sel ?? (row.status === "enabled" ? colors.positive : colors.textDim),
      };
  }
}

function buildPluginDetails(
  registry: ReturnType<typeof getSharedRegistry>,
  row: InspectorRow,
): PluginDetailItem[] {
  if (!registry || !row) return [];
  const items: PluginDetailItem[] = [];

  items.push({ label: "ID", value: row.id });
  items.push({ label: "Name", value: row.name });
  items.push({ label: "Version", value: row.version });
  items.push({ label: "Source", value: row.source });
  items.push({ label: "Status", value: row.status });
  if (row.description) items.push({ label: "Description", value: row.description });
  items.push({ label: "Toggleable", value: row.toggleable ? "yes" : "no" });
  if (row.path) items.push({ label: "Path", value: row.path });
  if (row.error) items.push({ label: "Error", value: row.error });

  // Registered panes
  const paneIds = registry.getPluginPaneIds(row.id);
  if (paneIds.length > 0) {
    items.push({ label: "Panes", value: paneIds.join(", ") });
  }

  // Pane templates
  const templateIds = registry.getPluginPaneTemplateIds(row.id);
  if (templateIds.length > 0) {
    items.push({ label: "Pane Templates", value: templateIds.join(", ") });
  }

  // Commands
  const commandIds: string[] = [];
  for (const [cmdId, _] of registry.commands) {
    if (registry.getCommandPluginId(cmdId) === row.id) commandIds.push(cmdId);
  }
  if (commandIds.length > 0) {
    items.push({ label: "Commands", value: commandIds.join(", ") });
  }

  // Shortcuts
  const shortcutIds: string[] = [];
  for (const [shortId, _] of registry.shortcuts) {
    if (registry.getShortcutPluginId(shortId) === row.id) shortcutIds.push(shortId);
  }
  if (shortcutIds.length > 0) {
    items.push({ label: "Shortcuts", value: shortcutIds.join(", ") });
  }

  // Ticker research tabs
  const tabIds: string[] = [];
  for (const [tabId, _] of registry.tickerResearchTabs) {
    if (registry.getTickerResearchTabPluginId(tabId) === row.id) tabIds.push(tabId);
  }
  if (tabIds.length > 0) {
    items.push({ label: "Research Tabs", value: tabIds.join(", ") });
  }

  // Capabilities
  const capabilities = registry.capabilities.list();
  const pluginCapabilities = capabilities
    .filter((entry) => registry.getCapabilityPluginId(entry.capability.id) === row.id)
    .map((entry) => `${entry.capability.id} (${entry.capability.kind})`);
  if (pluginCapabilities.length > 0) {
    items.push({ label: "Capabilities", value: pluginCapabilities.join(", ") });
  }

  return items;
}

export function PluginInspectorPane({ paneId, focused, width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const disabledPlugins = useAppSelector((state) => state.config.disabledPlugins);

  const columns = useMemo(() => buildInspectorColumns(width), [width]);

  const [sortPreference, setSortPreference] = useState<StackSortPreference<InspectorColumnId>>({
    columnId: "id",
    direction: "asc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const externalDirs = useMemo(() => getExternalPluginDirs(), [refreshCounter]);

  const rows = useMemo(
    () => buildInspectorRows(registry, disabledPlugins, externalDirs),
    [registry, disabledPlugins, externalDirs],
  );

  const visibleRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const cmp = compareInspectorRows(a, b, sortPreference.columnId);
      return sortPreference.direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortPreference]);

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

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  const openDetail = useCallback(() => {
    if (selectedRow) setDetailOpen(true);
  }, [selectedRow]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (isPlainKey(event, "o") && selectedRow?.path) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDetailOpen(true);
      return true;
    }
    return false;
  }, [refresh, selectedRow]);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "escape" || event.name === "backspace") {
      event.preventDefault?.();
      event.stopPropagation?.();
      closeDetail();
      return true;
    }
    return false;
  }, [closeDetail]);

  const detailItems = useMemo(
    () => (selectedRow ? buildPluginDetails(registry, selectedRow) : []),
    [registry, selectedRow],
  );

  const detailContent = selectedRow ? (
    <Box flexDirection="column" width={width} height={height} padding={1}>
      {detailItems.map((item) => (
        <Box key={item.label} flexDirection="row" height={1} gap={1}>
          <Box width={Math.min(16, Math.max(8, Math.floor(width * 0.25)))}>
            <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>{item.label}</Text>
          </Box>
          <Box flexGrow={1} flexDirection="row">
            <Text fg={colors.text} wrapMode="word" width={Math.max(10, width - Math.min(16, Math.max(8, Math.floor(width * 0.25))) - 2)}>
              {item.value}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  ) : null;

  const detailTitle = selectedRow
    ? `${selectedRow.name}  ${selectedRow.id}`
    : undefined;

  usePaneFooter(paneId, () => ({
    info: [],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      ...(selectedRow?.path
        ? [{ id: "open", key: "o", label: "pen", onPress: openDetail }]
        : []),
    ],
  }), [refresh, openDetail, selectedRow]);

  if (!registry) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <EmptyState title="Plugin registry unavailable." />
        </Box>
      </Box>
    );
  }

  return (
    <DataTableStackView<InspectorRow, InspectorColumn>
      focused={focused}
      detailOpen={detailOpen && !!selectedRow}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailTitle}
      onDetailKeyDown={handleDetailKeyDown}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => setDetailOpen(true)}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={visibleRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as InspectorColumnId;
        setSortPreference((current) => nextStackSortPreference(current, next, next === "id" || next === "name" ? "asc" : "desc"));
      }}
      onRootKeyDown={handleRootKeyDown}
      getItemKey={(row) => row.id}
      renderCell={(row, column, _index, rowState) => renderInspectorCell(row, column, rowState.selected)}
      emptyStateTitle="No plugins loaded."
      emptyStateHint="Plugins are registered at startup."
      showHorizontalScrollbar={false}
    />
  );
}
