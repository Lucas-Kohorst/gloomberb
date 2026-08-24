import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text } from "../../../ui";
import {
  DataTableView,
  EmptyState,
  Spinner,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { usePaneSettingValue } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { useShortcut } from "../../../react/input";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import { parseByokPayload, type ParsedByokPayload } from "./format";
import { fetchByokEndpoint } from "./request";
import { readByokKeysFromConfig } from "./store";
import { useAppSelector } from "../../../state/app/context";

export const BYOK_VIEWER_PANE_ID = "byok-api-viewer";
export const BYOK_VIEWER_TEMPLATE_ID = "byok-api-viewer-pane";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

export function ByokApiViewerPane({ focused, width, height }: PaneProps) {
  const [keyId] = usePaneSettingValue("keyId", "");
  const keys = useAppSelector((state) => readByokKeysFromConfig(state.config));
  const entry = keys.find((key) => key.id === keyId) ?? null;
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ParsedByokPayload | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const genRef = useRef(0);

  const load = useCallback(() => {
    if (!entry) {
      setPayload(null);
      setError("This API key is no longer saved.");
      setStatus("error");
      return;
    }
    genRef.current += 1;
    const gen = genRef.current;
    setStatus("loading");
    setError(null);
    void fetchByokEndpoint(entry)
      .then((result) => {
        if (genRef.current !== gen) return;
        setHttpStatus(result.status);
        if (!result.ok) {
          setError(`Request failed (${result.status}).`);
          setPayload({ kind: "text", text: result.body });
          setStatus("error");
          return;
        }
        setPayload(parseByokPayload(entry.dataFormat, result.contentType, result.body));
        setStatus("loaded");
      })
      .catch((loadError) => {
        if (genRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setPayload(null);
        setStatus("error");
      });
  }, [entry]);

  useEffect(() => {
    load();
  }, [load]);

  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "r") {
      event.stopPropagation();
      load();
    }
  }, { enabled: focused });

  usePaneFooter("byok-api-viewer", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(httpStatus != null ? [{ id: "http", parts: [{ text: String(httpStatus), tone: status === "error" ? "warning" as const : "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: load },
    ],
  }), [error, httpStatus, load, status]);

  if (!entry && status !== "loading") {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        <EmptyState title="API key not found." message={error ?? "Save the key again to open it."} />
      </Box>
    );
  }

  if (status === "loading" && !payload) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading API data..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ByokPayloadView payload={payload} focused={focused} width={width} height={height} />
    </Box>
  );
}

function ByokPayloadView({
  payload,
  focused,
  width,
  height,
}: {
  payload: ParsedByokPayload | null;
  focused: boolean;
  width: number;
  height: number;
}) {
  if (!payload) {
    return (
      <Box padding={1}>
        <EmptyState title="No data returned." />
      </Box>
    );
  }
  if (payload.kind === "text") {
    return (
      <ScrollBox flexGrow={1} scrollY>
        <Box paddingX={1} paddingY={1}>
          <Text fg={colors.text} wrapMode="word" width={Math.max(8, width - 2)}>
            {payload.text || "(empty)"}
          </Text>
        </Box>
      </ScrollBox>
    );
  }
  if (payload.kind === "pairs") {
    return (
      <ScrollBox flexGrow={1} scrollY>
        <Box flexDirection="column" paddingX={1} paddingY={1} gap={0}>
          {payload.pairs.map((pair) => (
            <Box key={pair.key} flexDirection="row" height={1} gap={2}>
              <Box width={Math.min(22, Math.floor(width * 0.3))}>
                <Text fg={colors.textDim}>{pair.key}</Text>
              </Box>
              <Text fg={colors.text} wrapMode="ellipsis">{pair.value}</Text>
            </Box>
          ))}
        </Box>
      </ScrollBox>
    );
  }

  return (
    <ByokTableView
      columns={payload.columns}
      rows={payload.rows}
      focused={focused}
      width={width}
      height={height}
    />
  );
}

function ByokTableView({
  columns: columnIds,
  rows,
  focused,
  width,
  height,
}: {
  columns: string[];
  rows: Array<Record<string, string>>;
  focused: boolean;
  width: number;
  height: number;
}) {
  const columns = useMemo<DataTableColumn[]>(() => {
    const count = Math.max(1, columnIds.length);
    const colWidth = Math.max(10, Math.floor((width - count - 2) / count));
    return columnIds.map((column) => ({
      id: column,
      label: column,
      width: colWidth,
      align: "left" as const,
      flexGrow: 1,
    }));
  }, [columnIds, width]);

  const [sortPreference, setSortPreference] = useState<SortPreference>({
    columnId: null,
    direction: "asc",
  });
  const sortedRows = useMemo(
    () => applySortPreference(rows, sortPreference, (row, columnId) => row[columnId] || null),
    [rows, sortPreference],
  );
  const renderCell = useCallback((row: Record<string, string>, column: DataTableColumn): DataTableCell => ({
    text: row[column.id] ?? "",
    color: colors.text,
  }), []);

  return (
    <DataTableView<Record<string, string>, DataTableColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      selection={{ kind: "none" }}
      columns={columns}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(current, columnId, {
        defaultDirection: "asc",
      }))}
      getItemKey={(_row, index) => `${index}`}
      renderCell={renderCell}
      emptyStateTitle="No rows."
      showHorizontalScrollbar={false}
    />
  );
}
