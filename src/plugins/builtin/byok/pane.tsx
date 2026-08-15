import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  SegmentedControl,
  TextField,
  usePaneFooter,
  type DataTableCell,
} from "../../../components";
import { DataTableView } from "../../../components";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { useShortcut } from "../../../react/input";
import { usePluginConfigState, usePluginAppActions } from "../../runtime";
import {
  BYOK_API_KEYS_CONFIG_KEY,
  BYOK_CUSTOM_SERVICE_ID,
  type ByokApiKeyEntry,
  type ByokDataFormat,
  type ByokStoredConfig,
} from "./types";
import {
  CUSTOM_SERVICE_OPTION,
  getByokKnownService,
  getByokKnownServices,
} from "./services";
import { fetchByokEndpoint, isByokTestSuccess } from "./request";
import { isOpenableCustomKey, maskApiKey } from "./store";
import { buildByokColumns, type ByokColumn } from "./columns";
import { BYOK_VIEWER_TEMPLATE_ID } from "./viewer";
import { getAiRuntimeCatalogSnapshot, subscribeAiRuntimeCatalog } from "../ai/runner";
import { useSyncExternalStore } from "react";

const ALL_SERVICES = [CUSTOM_SERVICE_OPTION, ...getByokKnownServices()];

type FormMode = "idle" | "add" | "edit";
type FormFieldKey = "serviceId" | "name" | "apiKey" | "apiUrl" | "dataFormat";

interface FormDraft {
  id?: string;
  serviceId: string;
  name: string;
  apiKey: string;
  apiUrl: string;
  dataFormat: ByokDataFormat;
}

function emptyDraft(): FormDraft {
  return {
    serviceId: ALL_SERVICES[0]!.id,
    name: "",
    apiKey: "",
    apiUrl: "",
    dataFormat: "auto",
  };
}

function draftFromEntry(entry: ByokApiKeyEntry): FormDraft {
  return {
    id: entry.id,
    serviceId: entry.serviceId,
    name: entry.name,
    apiKey: entry.apiKey,
    apiUrl: entry.apiUrl ?? "",
    dataFormat: entry.dataFormat ?? "auto",
  };
}

function serviceLabel(serviceId: string): string {
  if (serviceId === BYOK_CUSTOM_SERVICE_ID) return CUSTOM_SERVICE_OPTION.name;
  return getByokKnownService(serviceId)?.name ?? serviceId;
}

function statusLabel(entry: ByokApiKeyEntry): string {
  switch (entry.lastValidationStatus) {
    case "ok": return "OK";
    case "error": return "Error";
    default: return "Untested";
  }
}

function statusColor(entry: ByokApiKeyEntry): string {
  switch (entry.lastValidationStatus) {
    case "ok": return colors.positive;
    case "error": return colors.negative;
    default: return colors.textDim;
  }
}

function relativeTime(ms: number | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function renderByokCell(entry: ByokApiKeyEntry, column: ByokColumn): DataTableCell {
  const service = getByokKnownService(entry.serviceId);
  const isCustom = entry.serviceId === BYOK_CUSTOM_SERVICE_ID;
  const url = entry.apiUrl || service?.apiUrl || "";
  switch (column.id) {
    case "name":
      return { text: entry.name, color: colors.text };
    case "service":
      return { text: serviceLabel(entry.serviceId), color: colors.textDim };
    case "key":
      return { text: maskApiKey(entry.apiKey), color: colors.textDim };
    case "url":
      return { text: isCustom ? url : (service?.apiUrl ?? ""), color: colors.textMuted };
    case "status":
      return { text: statusLabel(entry), color: statusColor(entry) };
    case "validated":
      return { text: relativeTime(entry.lastValidated), color: colors.textDim };
  }
}

export function ByokSettingsPane({ focused, width, height }: PaneProps) {
  const [stored, setStored] = usePluginConfigState<ByokStoredConfig>(BYOK_API_KEYS_CONFIG_KEY, { keys: [] });
  const { notify, createPaneFromTemplate } = usePluginAppActions();
  const keys = useMemo(() => {
    if (!stored?.keys || !Array.isArray(stored.keys)) return [] as ByokApiKeyEntry[];
    return stored.keys as ByokApiKeyEntry[];
  }, [stored]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [formMode, setFormMode] = useState<FormMode>("idle");
  const [draft, setDraft] = useState<FormDraft>(emptyDraft());
  const [activeField, setActiveField] = useState<FormFieldKey>("serviceId");
  const [testing, setTesting] = useState(false);

  // AI provider read-only display
  const aiCatalog = useSyncExternalStore(subscribeAiRuntimeCatalog, getAiRuntimeCatalogSnapshot, getAiRuntimeCatalogSnapshot);
  const aiAccounts = useMemo(
    () => aiCatalog.accounts.filter((a) => a.connectionState === "connected"),
    [aiCatalog.accounts],
  );

  useEffect(() => {
    if (selectedIdx >= keys.length) setSelectedIdx(Math.max(0, keys.length - 1));
  }, [keys.length, selectedIdx]);

  const selectedEntry = keys[Math.min(selectedIdx, keys.length - 1)] ?? null;

  const formFields: FormFieldKey[] = useMemo(() => {
    const isCustom = draft.serviceId === BYOK_CUSTOM_SERVICE_ID;
    const fields: FormFieldKey[] = ["serviceId", "name", "apiKey"];
    if (isCustom) fields.push("apiUrl", "dataFormat");
    return fields;
  }, [draft.serviceId]);

  useEffect(() => {
    if (!formFields.includes(activeField)) {
      setActiveField(formFields[0] ?? "serviceId");
    }
  }, [formFields, activeField]);

  const persistKeys = useCallback((next: ByokApiKeyEntry[]) => {
    setStored({ keys: next });
  }, [setStored]);

  const handleSave = useCallback(() => {
    const name = draft.name.trim();
    const apiKey = draft.apiKey.trim();
    if (!name) { notify({ body: "Name is required.", type: "error" }); return; }
    if (!apiKey) { notify({ body: "API key is required.", type: "error" }); return; }

    const isCustom = draft.serviceId === BYOK_CUSTOM_SERVICE_ID;
    const apiUrl = isCustom ? draft.apiUrl.trim() || undefined : undefined;
    const dataFormat = isCustom ? draft.dataFormat : undefined;

    if (formMode === "add") {
      const newEntry: ByokApiKeyEntry = {
        id: `byok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        serviceId: draft.serviceId,
        name,
        apiKey,
        apiUrl,
        dataFormat,
        createdAt: Date.now(),
        lastValidationStatus: "untested",
      };
      persistKeys([...keys, newEntry]);
      notify({ body: `Added key "${name}".`, type: "success" });
    } else if (formMode === "edit" && draft.id) {
      const next = keys.map((entry) =>
        entry.id === draft.id
          ? { ...entry, serviceId: draft.serviceId, name, apiKey, apiUrl, dataFormat, lastValidationStatus: "untested" as const }
          : entry,
      );
      persistKeys(next);
      notify({ body: `Updated key "${name}".`, type: "success" });
    }
    setFormMode("idle");
    setDraft(emptyDraft());
  }, [draft, formMode, keys, notify, persistKeys]);

  const handleDelete = useCallback(() => {
    if (!selectedEntry) return;
    const next = keys.filter((entry) => entry.id !== selectedEntry.id);
    persistKeys(next);
    notify({ body: `Deleted key "${selectedEntry.name}".`, type: "success" });
    setFormMode("idle");
  }, [keys, notify, persistKeys, selectedEntry]);

  const handleEdit = useCallback(() => {
    if (!selectedEntry) return;
    setDraft(draftFromEntry(selectedEntry));
    setFormMode("edit");
    setActiveField("serviceId");
  }, [selectedEntry]);

  const handleAdd = useCallback(() => {
    setDraft(emptyDraft());
    setFormMode("add");
    setActiveField("name");
  }, []);

  const handleCancel = useCallback(() => {
    setFormMode("idle");
    setDraft(emptyDraft());
  }, []);

  const handleTest = useCallback(async () => {
    if (!selectedEntry) return;
    setTesting(true);
    try {
      const result = await fetchByokEndpoint(selectedEntry);
      const ok = isByokTestSuccess(selectedEntry, result);
      persistKeys(keys.map((entry) =>
        entry.id === selectedEntry.id
          ? { ...entry, lastValidated: Date.now(), lastValidationStatus: ok ? "ok" : "error" }
          : entry,
      ));
      notify({
        body: ok
          ? selectedEntry.serviceId === BYOK_CUSTOM_SERVICE_ID
            ? `Connection OK (${result.status}). "${selectedEntry.name}" is in the command bar.`
            : `Connection OK (${result.status}).`
          : `Connection failed (${result.status}).`,
        type: ok ? "success" : "error",
      });
    } catch (error) {
      persistKeys(keys.map((entry) =>
        entry.id === selectedEntry.id
          ? { ...entry, lastValidated: Date.now(), lastValidationStatus: "error" }
          : entry,
      ));
      notify({
        body: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        type: "error",
      });
    } finally {
      setTesting(false);
    }
  }, [keys, notify, persistKeys, selectedEntry]);

  const updateField = useCallback((field: FormFieldKey, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleOpen = useCallback(() => {
    if (!selectedEntry || !isOpenableCustomKey(selectedEntry)) return;
    createPaneFromTemplate(BYOK_VIEWER_TEMPLATE_ID, {
      arg: selectedEntry.id,
      values: { title: selectedEntry.name },
    });
  }, [createPaneFromTemplate, selectedEntry]);

  const columns = useMemo(() => buildByokColumns(width), [width]);
  const editing = formMode !== "idle";
  const canOpen = selectedEntry != null && isOpenableCustomKey(selectedEntry);

  useShortcut((event) => {
    if (!focused) return;
    if (editing) {
      if (event.name === "escape") {
        event.stopPropagation();
        handleCancel();
        return;
      }
      if ((event.name === "tab" && event.shift) || event.name === "up") {
        event.stopPropagation();
        event.preventDefault?.();
        const index = formFields.indexOf(activeField);
        const next = index <= 0 ? formFields.length - 1 : index - 1;
        setActiveField(formFields[next] ?? "name");
        return;
      }
      if (event.name === "tab" || event.name === "down") {
        event.stopPropagation();
        event.preventDefault?.();
        const index = formFields.indexOf(activeField);
        setActiveField(formFields[(index + 1) % formFields.length] ?? "name");
        return;
      }
      if (event.name === "enter" || event.name === "return") {
        event.stopPropagation();
        event.preventDefault?.();
        handleSave();
      }
      return;
    }
    if (event.name === "a") {
      event.stopPropagation();
      handleAdd();
      return;
    }
    if (event.name === "e" && selectedEntry) {
      event.stopPropagation();
      handleEdit();
      return;
    }
    if (event.name === "t" && selectedEntry) {
      event.stopPropagation();
      void handleTest();
      return;
    }
    if (event.name === "o" && canOpen) {
      event.stopPropagation();
      handleOpen();
      return;
    }
    if (event.name === "d" && selectedEntry) {
      event.stopPropagation();
      handleDelete();
    }
  }, { enabled: focused, allowEditable: true });

  usePaneFooter("byok-settings", () => ({
    info: [
      ...(testing ? [{ id: "testing", parts: [{ text: "testing…", tone: "muted" as const }] }] : []),
    ],
    hints: editing
      ? [
          { id: "save", key: "Enter", label: " save", onPress: handleSave },
          { id: "cancel", key: "Esc", label: " cancel", onPress: handleCancel },
        ]
      : [
          { id: "add", key: "a", label: "dd", onPress: handleAdd },
          ...(selectedEntry ? [{ id: "edit", key: "e", label: "dit", onPress: handleEdit }] : []),
          ...(selectedEntry ? [{ id: "test", key: "t", label: "est", onPress: handleTest }] : []),
          ...(canOpen ? [{ id: "open", key: "o", label: "pen", onPress: handleOpen }] : []),
          ...(selectedEntry ? [{ id: "delete", key: "d", label: "elete", onPress: handleDelete }] : []),
        ],
  }), [testing, editing, handleSave, handleCancel, handleAdd, handleEdit, handleTest, handleOpen, handleDelete, selectedEntry, canOpen]);

  if (editing) {
    return (
      <ByokEditForm
        draft={draft}
        activeField={activeField}
        setActiveField={setActiveField}
        updateField={updateField}
        onSave={handleSave}
        onCancel={handleCancel}
        mode={formMode}
        width={width}
        height={height}
      />
    );
  }

  const tableHeight = Math.max(3, height - (aiAccounts.length > 0 ? Math.min(aiAccounts.length, 3) + 2 : 0));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={tableHeight} flexGrow={1} minHeight={3}>
        {keys.length === 0
          ? (
            <Box padding={1} flexDirection="column" gap={1}>
              <EmptyState
                title="No API keys configured."
                message="Add a key for Adjacent, Hyperliquid, SEC EDGAR, or a custom API."
              />
              <Button label="Add API key" variant="primary" onPress={handleAdd} shortcut="a" />
            </Box>
          )
          : (
            <DataTableView<ByokApiKeyEntry, ByokColumn>
              focused={focused}
              rootWidth={width}
              rootHeight={tableHeight}
              selection={{
                kind: "id",
                selectedId: selectedEntry?.id ?? null,
                getId: (entry) => entry.id,
                onChange: (id) => {
                  const index = keys.findIndex((entry) => entry.id === id);
                  if (index >= 0) setSelectedIdx(index);
                },
              }}
              columns={columns}
              items={keys}
              sortColumnId={null}
              sortDirection="asc"
              onHeaderClick={() => {}}
              getItemKey={(entry) => entry.id}
              renderCell={renderByokCell}
              onActivate={(entry) => {
                if (!isOpenableCustomKey(entry)) return;
                createPaneFromTemplate(BYOK_VIEWER_TEMPLATE_ID, {
                  arg: entry.id,
                  values: { title: entry.name },
                });
              }}
              emptyStateTitle="No API keys configured."
              emptyStateHint="Press [a] to add a key for a known service or custom API."
              showHorizontalScrollbar={false}
            />
          )}
      </Box>

      {aiAccounts.length > 0 && (
        <Box flexDirection="column" flexShrink={0} paddingX={1}>
          {aiAccounts.slice(0, 3).map((account) => (
            <Box key={account.providerId} height={1}>
              <Text fg={colors.textDim}>{account.providerLabel} </Text>
              <Text fg={colors.positive}>connected</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ByokEditForm({
  draft,
  activeField,
  setActiveField,
  updateField,
  onSave,
  onCancel,
  mode,
  width,
  height,
}: {
  draft: FormDraft;
  activeField: FormFieldKey;
  setActiveField: (key: FormFieldKey) => void;
  updateField: (field: FormFieldKey, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  mode: FormMode;
  width: number;
  height: number;
}) {
  const isCustom = draft.serviceId === BYOK_CUSTOM_SERVICE_ID;
  const fieldWidth = Math.max(16, width - 4);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY>
        <Box flexDirection="column" padding={1}>
          <Box height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              {mode === "add" ? "Add API Key" : "Edit API Key"}
            </Text>
          </Box>
          <Box height={1} />

          <Box
            flexDirection="column"
            onMouseDown={() => setActiveField("serviceId")}
            height={3}
          >
            <Text fg={activeField === "serviceId" ? colors.textBright : colors.textDim}>
              {activeField === "serviceId" ? "> " : "  "}Service
            </Text>
            <SegmentedControl
              value={draft.serviceId}
              options={ALL_SERVICES.map((s) => ({ label: s.name, value: s.id }))}
              onChange={(value) => updateField("serviceId", value)}
            />
          </Box>

          <Box height={1} />

          <Box onMouseDown={() => setActiveField("name")} height={3}>
            <TextField
              label={`${activeField === "name" ? "> " : "  "}Name`}
              value={draft.name}
              focused={activeField === "name"}
              width={fieldWidth}
              placeholder="My Adjacent key"
              onChange={(value) => updateField("name", value)}
              onSubmit={onSave}
            />
          </Box>

          <Box height={1} />

          <Box onMouseDown={() => setActiveField("apiKey")} height={3}>
            <TextField
              label={`${activeField === "apiKey" ? "> " : "  "}API Key`}
              value={draft.apiKey}
              focused={activeField === "apiKey"}
              width={fieldWidth}
              type="password"
              placeholder="sk-..."
              onChange={(value) => updateField("apiKey", value)}
              onSubmit={onSave}
            />
          </Box>

          {isCustom && (
            <>
              <Box height={1} />
              <Box onMouseDown={() => setActiveField("apiUrl")} height={3}>
                <TextField
                  label={`${activeField === "apiUrl" ? "> " : "  "}API URL`}
                  value={draft.apiUrl}
                  focused={activeField === "apiUrl"}
                  width={fieldWidth}
                  placeholder="https://api.example.com/v1"
                  onChange={(value) => updateField("apiUrl", value)}
                  onSubmit={onSave}
                />
              </Box>
              <Box height={1} />
              <Box
                flexDirection="column"
                onMouseDown={() => setActiveField("dataFormat")}
                height={3}
              >
                <Text fg={activeField === "dataFormat" ? colors.textBright : colors.textDim}>
                  {activeField === "dataFormat" ? "> " : "  "}Data Format
                </Text>
                <SegmentedControl
                  value={draft.dataFormat}
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "JSON", value: "json" },
                    { label: "CSV", value: "csv" },
                    { label: "Text", value: "text" },
                  ]}
                  onChange={(value) => updateField("dataFormat", value)}
                />
              </Box>
            </>
          )}

          <Box height={1} />
          <Box flexDirection="row" gap={2}>
            <Button label="Save" variant="primary" onPress={onSave} shortcut="Enter" />
            <Button label="Cancel" variant="secondary" onPress={onCancel} shortcut="Esc" />
          </Box>

          <Box height={1} />
          <Box height={1}>
            <Text fg={colors.textMuted} wrapMode="word" width={Math.max(12, width - 4)}>
              {getByokKnownService(draft.serviceId)?.description ?? CUSTOM_SERVICE_OPTION.description}
            </Text>
          </Box>
        </Box>
      </ScrollBox>
    </Box>
  );
}
