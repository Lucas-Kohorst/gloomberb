import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import {
  Button,
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
import { AI_DEFAULT_PROVIDER_SETTING_KEY } from "../ai/pane-settings";
import {
  getAiRuntimeCatalogSnapshot,
  subscribeAiRuntimeCatalog,
  checkAiProviderStatus,
  connectAiRuntimeProvider,
} from "../ai/runner";
import { getBrowserAiStateSnapshot, refreshBrowserAiState } from "../ai/browser";
import { isHostedWebClient } from "../ai/providers";
import {
  aiInventoryFixAction,
  aiInventoryStatusLabel,
  aiInventoryStatusColor,
  byokKeysConfigSelector,
  canSelectAiProvider,
  checkOllamaAvailability,
  OLLAMA_BYOK_SERVICE_ID,
  OLLAMA_DEFAULT_URL,
  resolveAiInventory,
  resolveOllamaEndpoint,
  type AiInventoryStatus,
  type AiProviderInventoryRow,
  type OllamaAvailability,
} from "./ai-providers";
import { t } from "../../../i18n";

const AI_PLUGIN_ID = "ai";

export type AiColumnId = "provider" | "status" | "active" | "fix";

export type AiColumn = DataTableColumn & { id: AiColumnId };

interface ColumnSpec {
  id: AiColumnId;
  label: string;
  min: number;
  flex: number;
}

const PROVIDER_COL: ColumnSpec = { id: "provider", label: "Provider", min: 16, flex: 3 };
const STATUS_COL: ColumnSpec = { id: "status", label: "Status", min: 10, flex: 2 };
const ACTIVE_COL: ColumnSpec = { id: "active", label: "Active", min: 7, flex: 0 };
const FIX_COL: ColumnSpec = { id: "fix", label: "Action", min: 12, flex: 2 };

const COLUMN_SETS: ColumnSpec[][] = [
  [PROVIDER_COL, STATUS_COL, ACTIVE_COL, FIX_COL],
  [PROVIDER_COL, STATUS_COL, ACTIVE_COL],
  [PROVIDER_COL, STATUS_COL],
];

const COLUMN_GAP = 1;
const HORIZONTAL_PADDING = 1;

function minTableWidth(specs: ColumnSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.min, 0)
    + specs.length * COLUMN_GAP
    + HORIZONTAL_PADDING * 2;
}

function layoutAiColumns(specs: ColumnSpec[], width: number): AiColumn[] {
  const extra = Math.max(0, Math.floor(width) - minTableWidth(specs));
  const flexSum = specs.reduce((sum, spec) => sum + spec.flex, 0);
  let assigned = 0;
  const flexIndexes = specs.flatMap((spec, index) => spec.flex > 0 ? [index] : []);
  const lastFlex = flexIndexes[flexIndexes.length - 1];

  return specs.map((spec, index) => {
    let grow = 0;
    if (flexSum > 0 && spec.flex > 0) {
      if (index === lastFlex) grow = extra - assigned;
      else {
        grow = Math.floor(extra * spec.flex / flexSum);
        assigned += grow;
      }
    }
    return {
      id: spec.id,
      label: spec.label,
      width: spec.min + grow,
      align: "left" as const,
      flexGrow: spec.flex > 0 ? spec.flex : undefined,
    };
  });
}

function buildAiColumns(width: number): AiColumn[] {
  const target = Math.max(20, Math.floor(width));
  const specs = COLUMN_SETS.find((set) => minTableWidth(set) <= target) ?? COLUMN_SETS[COLUMN_SETS.length - 1]!;
  return layoutAiColumns(specs, target);
}

function statusColor(status: AiInventoryStatus): string {
  const token = aiInventoryStatusColor(status);
  if (token === "positive") return colors.positive;
  if (token === "negative") return colors.negative;
  if (token === "warn") return colors.warning;
  return colors.textDim;
}

function compareAiRows(
  left: AiProviderInventoryRow,
  right: AiProviderInventoryRow,
  columnId: AiColumnId,
): number {
  switch (columnId) {
    case "provider":
      return left.name.localeCompare(right.name);
    case "status":
      return aiInventoryStatusLabel(left.status).localeCompare(aiInventoryStatusLabel(right.status));
    case "active":
      return (left.isActive ? 0 : 1) - (right.isActive ? 0 : 1);
    case "fix": {
      const leftFix = aiInventoryFixAction(left)?.label ?? "";
      const rightFix = aiInventoryFixAction(right)?.label ?? "";
      return leftFix.localeCompare(rightFix);
    }
  }
}

function renderAiCell(row: AiProviderInventoryRow, column: AiColumn): DataTableCell {
  switch (column.id) {
    case "provider":
      return {
        text: row.preferred ? `${row.name} ★` : row.name,
        color: row.isActive ? colors.textBright : colors.text,
        attributes: row.isActive ? TextAttributes.BOLD : 0,
      };
    case "status":
      return {
        text: aiInventoryStatusLabel(row.status),
        color: statusColor(row.status),
      };
    case "active":
      return {
        text: row.isActive ? "●" : "",
        color: colors.positive,
      };
    case "fix": {
      const action = aiInventoryFixAction(row);
      return {
        text: action?.label ?? (row.status === "available" ? "—" : ""),
        color: action ? colors.borderFocused : colors.textMuted,
      };
    }
  }
}

type KeyFormMode = "idle" | "add-key" | "edit-endpoint";

interface KeyFormDraft {
  providerId: string;
  serviceId: string;
  apiKey: string;
  apiUrl: string;
}

export function AiProvidersTab({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { runtime } = usePluginRenderContext();
  const byokKeys = useAppSelector(byokKeysConfigSelector);
  const aiCatalog = useSyncExternalStore(subscribeAiRuntimeCatalog, getAiRuntimeCatalogSnapshot, getAiRuntimeCatalogSnapshot);
  const activeProviderId = useAppSelector((state) => (
    (state.config.pluginConfig[AI_PLUGIN_ID]?.[AI_DEFAULT_PROVIDER_SETTING_KEY] as string | undefined) ?? null
  ));

  const [ollamaState, setOllamaState] = useState<OllamaAvailability | null>(null);
  const [browserAiState, setBrowserAiState] = useState(getBrowserAiStateSnapshot());
  const [sortPreference, setSortPreference] = useState<StackSortPreference<AiColumnId>>({
    columnId: "provider",
    direction: "asc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyFormMode, setKeyFormMode] = useState<KeyFormMode>("idle");
  const [keyDraft, setKeyDraft] = useState<KeyFormDraft | null>(null);
  const [testing, setTesting] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const inventory = useMemo(
    () => resolveAiInventory({
      catalog: aiCatalog,
      browserAiState,
      ollamaState,
      byokKeys,
      activeProviderId,
    }),
    [aiCatalog, browserAiState, ollamaState, byokKeys, activeProviderId],
  );

  const sortedRows = useMemo(
    () => sortStackItems(inventory.rows, sortPreference, compareAiRows),
    [inventory.rows, sortPreference],
  );

  const selectedRow = useMemo(
    () => sortedRows.find((row) => row.id === selectedId) ?? sortedRows[0] ?? null,
    [sortedRows, selectedId],
  );

  useEffect(() => {
    if (!selectedId && sortedRows.length > 0) {
      setSelectedId(sortedRows[0]!.id);
    }
  }, [sortedRows, selectedId]);

  // Refresh Ollama availability on mount and when the endpoint changes.
  const ollamaEndpoint = useMemo(() => resolveOllamaEndpoint(byokKeys), [byokKeys]);
  useEffect(() => {
    let cancelled = false;
    void checkOllamaAvailability(ollamaEndpoint).then((result) => {
      if (!cancelled) setOllamaState(result.availability);
    });
    return () => { cancelled = true; };
  }, [ollamaEndpoint]);

  // Refresh browser AI state on mount (hosted web only).
  useEffect(() => {
    if (!isHostedWebClient()) return;
    void refreshBrowserAiState().then((state) => setBrowserAiState(state));
  }, []);

  const persistByokKeys = useCallback((next: ByokApiKeyEntry[]) => {
    void runtime.setConfigState(BYOK_PLUGIN_ID, BYOK_API_KEYS_CONFIG_KEY, { keys: next } satisfies ByokStoredConfig);
  }, [runtime]);

  const setActiveProvider = useCallback((providerId: string) => {
    void runtime.setConfigState(AI_PLUGIN_ID, AI_DEFAULT_PROVIDER_SETTING_KEY, providerId);
  }, [runtime]);

  const handleActivate = useCallback(() => {
    if (!selectedRow || !canSelectAiProvider(selectedRow)) return;
    setActiveProvider(selectedRow.id);
  }, [selectedRow, setActiveProvider]);

  const handleRefresh = useCallback(async () => {
    if (!selectedRow) return;
    setBusyProvider(selectedRow.id);
    try {
      if (selectedRow.id === "ollama") {
        const result = await checkOllamaAvailability(resolveOllamaEndpoint(byokKeys));
        setOllamaState(result.availability);
      } else if (selectedRow.id === "browser-builtin") {
        if (isHostedWebClient()) {
          setBrowserAiState(await refreshBrowserAiState());
        }
      } else {
        await checkAiProviderStatus(selectedRow.id);
      }
    } finally {
      setBusyProvider(null);
    }
  }, [byokKeys, selectedRow]);

  const handleAddKey = useCallback(() => {
    if (!selectedRow || !selectedRow.byokServiceId) return;
    const existing = byokKeys.find((key) => key.serviceId === selectedRow.byokServiceId);
    setKeyDraft({
      providerId: selectedRow.id,
      serviceId: selectedRow.byokServiceId,
      apiKey: existing?.apiKey ?? "",
      apiUrl: existing?.apiUrl ?? (selectedRow.id === "ollama" ? OLLAMA_DEFAULT_URL : ""),
    });
    setKeyFormMode(selectedRow.id === "ollama" ? "edit-endpoint" : "add-key");
  }, [byokKeys, selectedRow]);

  const handleSaveKey = useCallback(() => {
    if (!keyDraft) return;
    const apiKey = keyDraft.apiKey.trim();
    const apiUrl = keyDraft.apiUrl.trim();
    if (keyDraft.serviceId !== OLLAMA_BYOK_SERVICE_ID && !apiKey) return;

    const existing = byokKeys.find((key) => key.serviceId === keyDraft.serviceId);
    if (existing) {
      persistByokKeys(byokKeys.map((key) => (
        key.id === existing.id
          ? { ...key, apiKey, ...(apiUrl ? { apiUrl } : {}), lastValidationStatus: "untested" as const }
          : key
      )));
    } else {
      const newEntry: ByokApiKeyEntry = {
        id: `byok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        serviceId: keyDraft.serviceId,
        name: selectedRow?.name ?? keyDraft.serviceId,
        apiKey: apiKey || "none",
        ...(apiUrl ? { apiUrl } : {}),
        createdAt: Date.now(),
        lastValidationStatus: "untested",
      };
      persistByokKeys([...byokKeys, newEntry]);
    }
    setKeyFormMode("idle");
    setKeyDraft(null);

    // Re-check Ollama after endpoint change.
    if (keyDraft.serviceId === OLLAMA_BYOK_SERVICE_ID) {
      setOllamaState("checking");
      void checkOllamaAvailability(apiUrl || OLLAMA_DEFAULT_URL).then((result) => setOllamaState(result.availability));
    }
  }, [byokKeys, keyDraft, persistByokKeys, selectedRow?.name]);

  const handleCancelKey = useCallback(() => {
    setKeyFormMode("idle");
    setKeyDraft(null);
  }, []);

  const handleDeleteKey = useCallback(() => {
    if (!selectedRow || !selectedRow.byokServiceId) return;
    persistByokKeys(byokKeys.filter((key) => key.serviceId !== selectedRow.byokServiceId));
  }, [byokKeys, persistByokKeys, selectedRow]);

  const handleSignIn = useCallback(async () => {
    if (!selectedRow) return;
    setBusyProvider(selectedRow.id);
    try {
      await connectAiRuntimeProvider(selectedRow.id);
    } catch {
      // The notify system handles user feedback; we just clear busy.
    } finally {
      setBusyProvider(null);
    }
  }, [selectedRow]);

  const handleFix = useCallback(() => {
    if (!selectedRow) return;
    const action = aiInventoryFixAction(selectedRow);
    if (!action) return;
    switch (action.kind) {
      case "add-key":
      case "download-model":
        if (action.kind === "download-model") {
          void handleRefresh();
        } else {
          handleAddKey();
        }
        break;
      case "start-ollama":
        handleAddKey();
        break;
      case "sign-in":
        void handleSignIn();
        break;
      case "none":
        break;
    }
  }, [selectedRow, handleAddKey, handleRefresh, handleSignIn]);

  const columns = useMemo(() => buildAiColumns(width), [width]);
  const editing = keyFormMode !== "idle";
  const canActivate = selectedRow != null && canSelectAiProvider(selectedRow) && !selectedRow.isActive;
  const canAddKey = selectedRow != null && selectedRow.byokServiceId != null;
  const canDeleteKey = selectedRow != null && selectedRow.byokServiceId != null && selectedRow.hasKey;
  const canSignIn = selectedRow != null && selectedRow.canOAuth && !selectedRow.hasKey && selectedRow.status !== "available";
  const canRefresh = selectedRow != null;

  usePaneFooter("ai-providers", () => ({
    info: [
      ...(busyProvider ? [{ id: "busy", parts: [{ text: "checking…", tone: "muted" as const }] }] : []),
      ...(selectedRow ? [{ id: "active-provider", parts: [{ text: selectedRow.isActive ? `${selectedRow.name} active` : `${selectedRow.name}: ${aiInventoryStatusLabel(selectedRow.status)}`, tone: selectedRow.isActive ? "positive" as const : "muted" as const }] }] : []),
    ],
    hints: editing
      ? [
          { id: "save-key", key: "Enter", label: " save", onPress: handleSaveKey },
          { id: "cancel-key", key: "Esc", label: " cancel", onPress: handleCancelKey },
        ]
      : [
          ...(canActivate ? [{ id: "activate", key: "Enter", label: "activate", onPress: handleActivate }] : []),
          ...(canAddKey ? [{ id: "add-key", key: "k", label: "ey", onPress: handleAddKey }] : []),
          ...(canSignIn ? [{ id: "sign-in", key: "s", label: "ign in", onPress: () => { void handleSignIn(); } }] : []),
          ...(canRefresh ? [{ id: "refresh", key: "r", label: "efresh", onPress: () => { void handleRefresh(); } }] : []),
          ...(canDeleteKey ? [{ id: "delete-key", key: "d", label: "elete key", onPress: handleDeleteKey }] : []),
        ],
  }), [busyProvider, editing, canActivate, canAddKey, canSignIn, canRefresh, canDeleteKey, handleActivate, handleAddKey, handleSignIn, handleRefresh, handleDeleteKey, handleSaveKey, handleCancelKey, selectedRow]);

  useShortcut((event) => {
    if (!focused) return;
    if (editing) {
      if (event.name === "escape") {
        event.stopPropagation();
        handleCancelKey();
        return;
      }
      if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        event.preventDefault?.();
        handleSaveKey();
      }
      return;
    }
    if (event.name === "enter" || event.name === "return") {
      if (canActivate) {
        event.stopPropagation();
        handleActivate();
      }
      return;
    }
    if (event.name === "k" && canAddKey) {
      event.stopPropagation();
      handleAddKey();
      return;
    }
    if (event.name === "s" && canSignIn) {
      event.stopPropagation();
      void handleSignIn();
      return;
    }
    if (event.name === "r" && canRefresh) {
      event.stopPropagation();
      void handleRefresh();
      return;
    }
    if (event.name === "d" && canDeleteKey) {
      event.stopPropagation();
      handleDeleteKey();
    }
  }, { enabled: focused, allowEditable: true });

  if (editing && keyDraft) {
    return (
      <KeyEditForm
        draft={keyDraft}
        isOllama={keyDraft.serviceId === OLLAMA_BYOK_SERVICE_ID}
        onChange={setKeyDraft}
        onSave={handleSaveKey}
        onCancel={handleCancelKey}
        width={width}
        height={height}
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={Math.max(2, height - 2)} flexGrow={1} minHeight={2}>
        {sortedRows.length === 0 ? (
          <Box padding={1}>
            <EmptyState
              title="No AI providers available."
              message="AI providers appear here once detected."
            />
          </Box>
        ) : (
          <DataTableView<AiProviderInventoryRow, AiColumn>
            focused={focused}
            rootWidth={width}
            rootHeight={Math.max(2, height - 2)}
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
              const next = columnId as AiColumnId;
              setSortPreference((current) => nextStackSortPreference(
                current,
                next,
                next === "active" ? "desc" : "asc",
              ));
            }}
            getItemKey={(row) => row.id}
            renderCell={renderAiCell}
            onActivate={(row) => {
              if (canSelectAiProvider(row) && !row.isActive) setActiveProvider(row.id);
            }}
            emptyStateTitle="No AI providers available."
            emptyStateHint="AI providers appear here once detected."
            showHorizontalScrollbar={false}
          />
        )}
      </Box>
      {selectedRow ? (
        <Box flexDirection="column" flexShrink={0} paddingX={1}>
          <Box height={1}>
            <Text fg={colors.textDim}>{selectedRow.preferred ? "★ " : ""}{selectedRow.name}: </Text>
            <Text fg={statusColor(selectedRow.status)}>{aiInventoryStatusLabel(selectedRow.status)}</Text>
            {selectedRow.isActive ? <Text fg={colors.positive}> · active</Text> : null}
            {busyProvider === selectedRow.id ? <Text fg={colors.textMuted}> · checking…</Text> : null}
          </Box>
          <Box height={1}>
            <Text fg={colors.textMuted} wrapMode="word" width={Math.max(12, width - 2)}>
              {selectedRow.detail}
            </Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function KeyEditForm({
  draft,
  isOllama,
  onChange,
  onSave,
  onCancel,
  width,
  height,
}: {
  draft: KeyFormDraft;
  isOllama: boolean;
  onChange: (draft: KeyFormDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  width: number;
  height: number;
}) {
  const fieldWidth = Math.max(16, width - 4);
  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY>
        <Box flexDirection="column" padding={1}>
          <Box height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              {isOllama ? "Ollama Endpoint" : `API Key · ${draft.providerId}`}
            </Text>
          </Box>
          <Box height={1} />
          {isOllama ? (
            <Box flexDirection="column" onMouseDown={() => {}} height={3}>
              <Text fg={colors.textDim}>{"  Endpoint URL"}</Text>
              <TextField
                label=""
                value={draft.apiUrl}
                focused
                width={fieldWidth}
                placeholder={OLLAMA_DEFAULT_URL}
                onChange={(value) => onChange({ ...draft, apiUrl: value })}
                onSubmit={onSave}
              />
            </Box>
          ) : (
            <Box flexDirection="column" onMouseDown={() => {}} height={3}>
              <Text fg={colors.textDim}>{"  API Key"}</Text>
              <TextField
                label=""
                value={draft.apiKey}
                focused
                width={fieldWidth}
                type="password"
                placeholder="sk-..."
                onChange={(value) => onChange({ ...draft, apiKey: value })}
                onSubmit={onSave}
              />
            </Box>
          )}
          <Box height={1} />
          <Box flexDirection="row" gap={2}>
            <Button label="Save" variant="primary" onPress={onSave} shortcut="Enter" />
            <Button label="Cancel" variant="secondary" onPress={onCancel} shortcut="Esc" />
          </Box>
          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.textMuted} wrapMode="word" width={Math.max(12, width - 4)}>
              {isOllama
                ? t("No API key required. Start Ollama with: ollama serve")
                : t("Keys are stored locally and never synced to the cloud.")}
            </Text>
          </Box>
        </Box>
      </ScrollBox>
    </Box>
  );
}
