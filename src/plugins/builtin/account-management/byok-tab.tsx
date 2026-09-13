import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  EmptyState,
  TextField,
  nextStackSortPreference,
  sortStackItems,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type StackSortPreference,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { useAppSelector } from "../../../state/app/context";
import { usePluginRenderContext } from "../../runtime/context";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokApiKeyEntry, type ByokStoredConfig } from "../byok/types";
import { getByokKnownServicesVersion, subscribeByokKnownServices } from "../byok/services";
import {
  byokKeysConfigSelector,
  pluginByokStatusLabel,
  resolvePluginByokInventory,
  type PluginByokRow,
  type PluginByokStatus,
} from "./byok-inventory";

export type ByokColumnId = "service" | "plugin" | "status" | "source";
export type ByokColumn = DataTableColumn & { id: ByokColumnId };

export function buildPluginByokColumns(): ByokColumn[] {
  return [
    { id: "service", label: "Service", width: 18, align: "left", flexGrow: 1 },
    { id: "plugin", label: "Plugin", width: 14, align: "left" },
    { id: "status", label: "Status", width: 10, align: "left" },
    { id: "source", label: "Source", width: 8, align: "left" },
  ];
}

function statusColor(status: PluginByokStatus): string {
  if (status === "attached") return colors.positive;
  if (status === "env") return colors.warning;
  return colors.textDim;
}

function compareByokRows(left: PluginByokRow, right: PluginByokRow, columnId: ByokColumnId): number {
  switch (columnId) {
    case "service":
      return left.name.localeCompare(right.name);
    case "plugin":
      return (left.pluginName ?? left.pluginId ?? "").localeCompare(right.pluginName ?? right.pluginId ?? "");
    case "status":
      return pluginByokStatusLabel(left.status).localeCompare(pluginByokStatusLabel(right.status));
    case "source":
      return left.source.localeCompare(right.source);
  }
}

function renderByokCell(row: PluginByokRow, column: ByokColumn): DataTableCell {
  switch (column.id) {
    case "service":
      return { text: row.name, color: colors.textBright };
    case "plugin":
      return { text: row.pluginName ?? row.pluginId ?? "—", color: colors.textDim };
    case "status":
      return { text: pluginByokStatusLabel(row.status), color: statusColor(row.status) };
    case "source":
      return {
        text: row.source === "stored" ? "local" : row.source === "env" ? "env" : "—",
        color: colors.textMuted,
      };
  }
}

interface KeyFormDraft {
  serviceId: string;
  apiKey: string;
}

export function AccountByokTab({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { runtime } = usePluginRenderContext();
  const byokKeys = useAppSelector(byokKeysConfigSelector);
  const servicesVersion = useSyncExternalStore(
    subscribeByokKnownServices,
    getByokKnownServicesVersion,
    getByokKnownServicesVersion,
  );
  const inventory = useMemo(
    () => resolvePluginByokInventory(byokKeys),
    [byokKeys, servicesVersion],
  );
  const [sortPreference, setSortPreference] = useState<StackSortPreference<ByokColumnId>>({
    columnId: "service",
    direction: "asc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(inventory[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<KeyFormDraft | null>(null);

  const sortedRows = useMemo(
    () => sortStackItems(inventory, sortPreference, compareByokRows),
    [inventory, sortPreference],
  );
  const selectedRow = useMemo(
    () => sortedRows.find((row) => row.id === selectedId) ?? sortedRows[0] ?? null,
    [sortedRows, selectedId],
  );

  useEffect(() => {
    if (selectedId && sortedRows.some((row) => row.id === selectedId)) return;
    setSelectedId(sortedRows[0]?.id ?? null);
  }, [sortedRows, selectedId]);

  const persistByokKeys = useCallback((next: ByokApiKeyEntry[]) => {
    void runtime.setConfigState(BYOK_PLUGIN_ID, BYOK_API_KEYS_CONFIG_KEY, { keys: next } satisfies ByokStoredConfig);
  }, [runtime]);

  const handleAddKey = useCallback(() => {
    if (!selectedRow) return;
    const existing = byokKeys.find((key) => key.serviceId === selectedRow.id);
    setDraft({ serviceId: selectedRow.id, apiKey: existing?.apiKey ?? "" });
    setEditing(true);
  }, [byokKeys, selectedRow]);

  const handleSaveKey = useCallback(() => {
    if (!draft) return;
    const apiKey = draft.apiKey.trim();
    if (!apiKey) return;
    const existing = byokKeys.find((key) => key.serviceId === draft.serviceId);
    if (existing) {
      persistByokKeys(byokKeys.map((key) => (
        key.id === existing.id
          ? { ...key, apiKey, lastValidationStatus: "untested" as const }
          : key
      )));
    } else {
      persistByokKeys([
        ...byokKeys,
        {
          id: `byok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          serviceId: draft.serviceId,
          name: selectedRow?.name ?? draft.serviceId,
          apiKey,
          createdAt: Date.now(),
          lastValidationStatus: "untested",
        },
      ]);
    }
    setEditing(false);
    setDraft(null);
  }, [byokKeys, draft, persistByokKeys, selectedRow?.name]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft(null);
  }, []);

  const handleDeleteKey = useCallback(() => {
    if (!selectedRow) return;
    persistByokKeys(byokKeys.filter((key) => key.serviceId !== selectedRow.id));
  }, [byokKeys, persistByokKeys, selectedRow]);

  const canAddKey = selectedRow != null;
  const canDeleteKey = selectedRow?.source === "stored";
  const columns = useMemo(() => buildPluginByokColumns(), []);

  usePaneFooter("account-byok", () => ({
    info: selectedRow?.description
      ? [{ id: "desc", parts: [{ text: selectedRow.description, tone: "muted" as const }] }]
      : [],
    hints: editing
      ? []
      : [
          ...(canAddKey ? [{ id: "add-key", key: "k", label: "ey", onPress: handleAddKey }] : []),
          ...(canDeleteKey ? [{ id: "delete-key", key: "d", label: "elete key", onPress: handleDeleteKey }] : []),
        ],
  }), [canAddKey, canDeleteKey, editing, handleAddKey, handleDeleteKey, selectedRow?.description]);

  useShortcut((event) => {
    if (!focused) return;
    if (editing) {
      if (event.name === "escape") {
        event.stopPropagation();
        handleCancel();
        return;
      }
      if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        event.preventDefault?.();
        handleSaveKey();
      }
      return;
    }
    if (event.name === "k" && canAddKey) {
      event.stopPropagation();
      handleAddKey();
      return;
    }
    if (event.name === "d" && canDeleteKey) {
      event.stopPropagation();
      handleDeleteKey();
    }
  }, { enabled: focused, allowEditable: true });

  if (editing && draft) {
    const fieldWidth = Math.max(16, width - 4);
    return (
      <Box flexDirection="column" width={width} height={height} padding={1} gap={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {`API Key · ${selectedRow?.name ?? draft.serviceId}`}
        </Text>
        {selectedRow?.envVar ? (
          <Text fg={colors.textMuted}>{`Env fallback ${selectedRow.envVar}`}</Text>
        ) : null}
        <TextField
          label=""
          value={draft.apiKey}
          focused
          width={fieldWidth}
          placeholder="paste key"
          onChange={(value) => setDraft({ ...draft, apiKey: value })}
          onSubmit={handleSaveKey}
        />
        <Text fg={colors.textDim}>Enter to save · Esc to cancel</Text>
      </Box>
    );
  }

  if (sortedRows.length === 0) {
    return (
      <Box padding={1}>
        <EmptyState
          title="No plugin keys to attach."
          message="Plugins that accept a personal API key appear here after they register."
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height} flexGrow={1}>
      <DataTableView<PluginByokRow, ByokColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={height}
        selection={{
          kind: "id",
          selectedId: selectedRow?.id ?? null,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        columns={columns}
        items={sortedRows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          const next = columnId as ByokColumnId;
          setSortPreference((current) => nextStackSortPreference(current, next, "asc"));
        }}
        onRootKeyDown={(event) => {
          if (event.name === "k" && canAddKey) {
            event.stopPropagation?.();
            event.preventDefault?.();
            handleAddKey();
            return true;
          }
        }}
        getItemKey={(row) => row.id}
        renderCell={renderByokCell}
        onActivate={() => handleAddKey()}
        emptyStateTitle="No plugin keys to attach."
      />
    </Box>
  );
}
