import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { DataTableStackView } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { t, tf } from "../../../i18n";
import { ConnectionTracker } from "./tracker";
import type { ConnectionState } from "./types";
import {
  buildConnectionColumns,
  renderConnectionCell,
  statusColor,
  type ConnectionColumn,
} from "./table";
import { ConnectionDetailContent } from "./detail";
import { useConnectionsFooter } from "./footer";
import { useConnectionsKeyboard } from "./keyboard";

let sharedTracker: ConnectionTracker | null = null;

export function setSharedConnectionTracker(tracker: ConnectionTracker | null): void {
  sharedTracker = tracker;
}

export function ConnectionsPane({ focused, width, height }: PaneProps) {
  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sortMode, setSortMode] = useState<"status" | "lastPoll">("status");
  const versionRef = useRef(0);

  useEffect(() => {
    if (!sharedTracker) return;
    const dispose = sharedTracker.subscribe((snapshot) => {
      versionRef.current = snapshot.version;
      setConnections(sortConnections(snapshot.connections, sortMode));
    });
    return dispose;
  }, [sortMode]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, connections.length - 1)));
  }, [connections.length]);

  useEffect(() => {
    if (connections.length === 0) setDetailOpen(false);
  }, [connections.length]);

  const selectedRow = connections[Math.min(selectedIndex, connections.length - 1)] ?? null;

  const handleRefresh = useCallback(() => {
    sharedTracker?.refresh();
  }, []);

  const handleOpenDetail = useCallback(() => {
    if (selectedRow) setDetailOpen(true);
  }, [selectedRow]);

  const handleBack = useCallback(() => {
    setDetailOpen(false);
  }, []);

  useConnectionsFooter({ onRefresh: handleRefresh });
  useConnectionsKeyboard({
    focused,
    detailOpen,
    hasSelection: !!selectedRow,
    onRefresh: handleRefresh,
    onOpenDetail: handleOpenDetail,
    onBack: handleBack,
  });

  const connectedCount = connections.filter((c) => c.status === "connected").length;
  const errorCount = connections.filter((c) => c.status === "error" || c.status === "disconnected").length;
  const idleCount = connections.filter((c) => c.status === "idle").length;
  const bodyHeight = Math.max(5, height - 4);
  const tableWidth = Math.max(24, width - 2);
  const columns = useMemo(() => buildConnectionColumns(tableWidth), [tableWidth]);

  const selectRow = useCallback((index: number, _row: ConnectionState) => {
    setSelectedIndex(index);
  }, []);

  const openDetail = useCallback((index: number, _row: ConnectionState) => {
    setSelectedIndex(index);
    setDetailOpen(true);
  }, []);

  const detailContentWidth = Math.max(24, tableWidth - 2);
  const detailContent = (
    <ConnectionDetailContent row={selectedRow} width={detailContentWidth} />
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box height={1} flexDirection="row">
        <Box flexGrow={1} flexDirection="row">
          <Box width={12}>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{t("Connections")}</Text>
          </Box>
          <Text fg={colors.textDim}>{
            tf("{total} services · {connected} live · {idle} idle · {issues} issues",
              { total: connections.length, connected: connectedCount, idle: idleCount, issues: errorCount })
          }</Text>
        </Box>
      </Box>
      <Box height={1}>
        <Text fg={colors.textDim}>{t("API connections, data providers, and streaming health.")}</Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.border}>{"\u2500".repeat(Math.max(1, width - 2))}</Text>
      </Box>

      <Box height={bodyHeight} overflow="hidden">
        <DataTableStackView<ConnectionState, ConnectionColumn>
          focused={focused}
          detailOpen={detailOpen && !!selectedRow}
          onBack={handleBack}
          detailContent={detailContent}
          detailTitle={selectedRow?.name}
          rootWidth={tableWidth}
          rootHeight={bodyHeight}
          selection={{
            kind: "index",
            selectedIndex: Math.min(selectedIndex, Math.max(0, connections.length - 1)),
            onChange: (index, row) => selectRow(index, row),
          }}
          onActivate={(row, index) => openDetail(index, row)}
          columns={columns}
          items={connections}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => {
            setSortMode((prev) => prev === "status" ? "lastPoll" : "status");
          }}
          getItemKey={(row) => row.id}
          renderCell={renderConnectionCell}
          emptyStateTitle={t("No connections registered.")}
          emptyStateHint={t("Connections appear when data providers are registered.")}
          showHorizontalScrollbar={false}
        />
      </Box>
    </Box>
  );
}

function sortConnections(
  connections: ConnectionState[],
  mode: "status" | "lastPoll",
): ConnectionState[] {
  const statusOrder: Record<string, number> = {
    error: 0,
    disconnected: 1,
    reconnecting: 2,
    connected: 3,
    idle: 4,
  };

  if (mode === "lastPoll") {
    return [...connections].sort((a, b) => {
      const aTime = a.lastPolledAt ?? 0;
      const bTime = b.lastPolledAt ?? 0;
      return bTime - aTime;
    });
  }

  return [...connections].sort((a, b) => {
    const orderDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.name.localeCompare(b.name);
  });
}
