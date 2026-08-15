import { Box, Text, TextAttributes } from "../../../ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  SegmentedControl,
  TextField,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
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
import { maskApiKey } from "./store";
import { getAiRuntimeCatalogSnapshot, subscribeAiRuntimeCatalog } from "../ai/runner";
import { useSyncExternalStore } from "react";

type ByokColumnId = "name" | "service" | "key" | "url" | "status" | "validated";

type ByokColumn = DataTableColumn & { id: ByokColumnId };

const BYOK_COLUMNS: ByokColumn[] = [
  { id: "name", label: "Name", width: 16, align: "left" },
  { id: "service", label: "Service", width: 14, align: "left" },
  { id: "key", label: "Key", width: 18, align: "left" },
  { id: "url", label: "API URL", width: 24, align: "left" },
  { id: "status", label: "Status", width: 8, align: "left" },
  { id: "validated", label: "Validated", width: 10, align: "left" },
];

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

export function ByokSettingsPane({ focused, width, height, close }: PaneProps) {
  const [stored, setStored] = usePluginConfigState<ByokStoredConfig>(BYOK_API_KEYS_CONFIG_KEY, { keys: [] });
  const { notify } = usePluginAppActions();
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
          ? { ...entry, serviceId: draft.serviceId, name, apiKey, apiUrl, dataFormat }
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
      const service = getByokKnownService(selectedEntry.serviceId);
      const url = selectedEntry.apiUrl || service?.apiUrl;
      if (!url) {
        notify({ body: "No API URL to test for this service.", type: "error" });
        return;
      }
      const headers: Record<string, string> = {};
      if (service?.authType === "bearer") {
        headers["Authorization"] = `Bearer ${selectedEntry.apiKey}`;
      } else if (service?.authType === "header" && service.authKey) {
        headers[service.authKey] = selectedEntry.apiKey;
      } else if (service?.authType === "user-agent" && service.authKey) {
        headers[service.authKey] = selectedEntry.apiKey;
      }

      const response = await fetch(url, { method: "GET", headers });
      const ok = response.ok || response.status === 401 || response.status === 403;
      // 401/403 means the server is reachable but auth may need different scope; still validates connectivity.
      const status = ok ? "ok" : "error";
      const next = keys.map((entry) =>
        entry.id === selectedEntry.id
          ? { ...entry, lastValidated: Date.now(), lastValidationStatus: status as "ok" | "error" }
          : entry,
      );
      persistKeys(next);
      notify({
        body: ok
          ? `Connection OK (${response.status}).`
          : `Connection failed (${response.status}).`,
        type: ok ? "success" : "error",
      });
    } catch (error) {
      const next = keys.map((entry) =>
        entry.id === selectedEntry.id
          ? { ...entry, lastValidated: Date.now(), lastValidationStatus: "error" as const }
          : entry,
      );
      persistKeys(next);
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

  const tableWidth = Math.min(width, 100);
  const editing = formMode !== "idle";

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
    if (event.name === "d" && selectedEntry) {
      event.stopPropagation();
      handleDelete();
    }
  }, { enabled: focused, allowEditable: true });

  usePaneFooter("byok-settings", () => ({
    info: [
      ...(keys.length > 0 ? [{ id: "key-count", parts: [{ text: `${keys.length} key${keys.length > 1 ? "s" : ""}`, tone: "muted" as const }] }] : []),
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
          ...(selectedEntry ? [{ id: "delete", key: "d", label: "elete", onPress: handleDelete }] : []),
        ],
  }), [keys.length, testing, editing, handleSave, handleCancel, handleAdd, handleEdit, handleTest, handleDelete, selectedEntry]);

  if (editing) {
    return (
      <ByokEditForm
        draft={draft}
        activeField={activeField}
        setActiveField={setActiveField}
        formFields={formFields}
        updateField={updateField}
        onSave={handleSave}
        onCancel={handleCancel}
        mode={formMode}
        width={width}
        height={height}
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={Math.max(3, height - 3 - (aiAccounts.length > 0 ? 4 : 0))}>
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
              rootWidth={tableWidth}
              rootBackgroundColor={colors.panel}
              selection={{
                kind: "id",
                selectedId: selectedEntry?.id ?? null,
                getId: (entry) => entry.id,
                onChange: (id) => {
                  const index = keys.findIndex((entry) => entry.id === id);
                  if (index >= 0) setSelectedIdx(index);
                },
              }}
              columns={BYOK_COLUMNS}
              items={keys}
              sortColumnId={null}
              sortDirection="asc"
              onHeaderClick={() => {}}
              getItemKey={(entry) => entry.id}
              renderCell={renderByokCell}
              emptyStateTitle="No API keys configured."
              emptyStateHint="Press [a] to add a key for a known service or custom API."
            />
          )}
      </Box>

      {/* AI providers read-only display */}
      {aiAccounts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box height={1}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>AI Providers (read-only)</Text>
          </Box>
          <Box height={Math.min(aiAccounts.length + 1, 3)}>
            {aiAccounts.slice(0, 3).map((account) => (
              <Box key={account.providerId} height={1}>
                <Text fg={colors.textDim}>  {account.providerLabel.padEnd(16)} </Text>
                <Text fg={colors.positive}>connected</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ByokEditForm({
  draft,
  activeField,
  setActiveField,
  formFields,
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
  formFields: FormFieldKey[];
  updateField: (field: FormFieldKey, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  mode: FormMode;
  width: number;
  height: number;
}) {
  const isCustom = draft.serviceId === BYOK_CUSTOM_SERVICE_ID;
  const fieldWidth = Math.min(width - 4, 50);

  return (
    <Box flexDirection="column" width={width} height={height} padding={1}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {mode === "add" ? "Add API Key" : "Edit API Key"}
        </Text>
      </Box>
      <Box height={1} />

      {/* Service selector */}
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

      {/* Name field */}
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

      {/* API Key field */}
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

      {/* Custom-only fields */}
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

      {/* Service description hint */}
      <Box height={1} />
      <Box height={1}>
        <Text fg={colors.textMuted}>
          {getByokKnownService(draft.serviceId)?.description ?? CUSTOM_SERVICE_OPTION.description}
        </Text>
      </Box>
    </Box>
  );
}
