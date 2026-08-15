import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, useRendererHost } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";
import { fetchVoteHubPolls } from "./client";
import {
  formatPollDate,
  normalizeVoteHubPoll,
  sortPollRows,
} from "./normalize";
import type { PollRow, PollTabId } from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface PollColumn extends DataTableColumn {
  id: "date" | "subject" | "pollster" | "pop" | "result";
}

const TABS: Array<{ value: PollTabId; label: string }> = [
  { value: "approval", label: "Approval" },
  { value: "favorability", label: "Favorability" },
  { value: "generic-ballot", label: "Generic" },
  { value: "us-senator", label: "Senate" },
  { value: "governor", label: "Governor" },
  { value: "us-representative", label: "House" },
];

function createColumns(width: number): PollColumn[] {
  const dateWidth = 8;
  const popWidth = 4;
  const resultWidth = 22;
  const pollsterWidth = 14;
  const subjectWidth = Math.max(12, width - dateWidth - popWidth - resultWidth - pollsterWidth - 8);
  return [
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "subject", label: "SUBJECT", width: subjectWidth, align: "left" },
    { id: "pollster", label: "POLLSTER", width: pollsterWidth, align: "left" },
    { id: "pop", label: "POP", width: popWidth, align: "left" },
    { id: "result", label: "RESULT", width: resultWidth, align: "left" },
  ];
}

function renderPollCell(row: PollRow, column: PollColumn, selected: boolean): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "date":
      return { text: formatPollDate(row.endDate), color: sel ?? colors.textDim };
    case "subject":
      return { text: row.subject, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "pollster":
      return { text: row.pollster, color: sel ?? colors.textMuted };
    case "pop":
      return { text: row.population, color: sel ?? colors.textDim };
    case "result":
      return {
        text: row.result,
        color: sel ?? (row.lead != null ? priceColor(row.lead) : colors.text),
      };
  }
}

function PollDetail({ poll, width }: { poll: PollRow; width: number }) {
  const lineWidth = Math.max(12, width - 2);
  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD} wrapMode="word" width={lineWidth}>
          {poll.subject}
        </Text>
        <Text fg={colors.textDim}>
          {poll.pollTypeLabel}
          {poll.sponsors.length > 0 ? ` · ${poll.sponsors.join(", ")}` : ""}
        </Text>
        <Text fg={colors.textDim}>
          {formatPollDate(poll.startDate)}–{formatPollDate(poll.endDate)}
          {` · ${poll.pollster} · ${poll.population}`}
          {poll.sampleSize != null ? ` · n=${poll.sampleSize.toLocaleString("en-US")}` : ""}
        </Text>
        {poll.answers.map((answer) => (
          <Box key={answer.choice} flexDirection="row" height={1} gap={2}>
            <Box width={Math.min(16, Math.floor(lineWidth * 0.35))}>
              <Text fg={colors.text}>{answer.choice}</Text>
            </Box>
            <Text fg={poll.leadChoice === answer.choice ? colors.textBright : colors.textDim} attributes={TextAttributes.BOLD}>
              {Number.isInteger(answer.pct) ? `${answer.pct}` : answer.pct.toFixed(1)}
            </Text>
          </Box>
        ))}
        {poll.partisan ? <Text fg={colors.textMuted}>Partisan: {poll.partisan}</Text> : null}
        {poll.internal ? <Text fg={colors.textMuted}>Internal poll</Text> : null}
      </Box>
    </ScrollBox>
  );
}

export function PollsPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const [tab, setTab] = useState<PollTabId>("approval");
  const [rowsByTab, setRowsByTab] = useState<Partial<Record<PollTabId, PollRow[]>>>({});
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const genRef = useRef(0);

  const rows = rowsByTab[tab] ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const load = useCallback((pollType: PollTabId) => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus("loading");
    setError(null);
    fetchVoteHubPolls({ pollType })
      .then((polls) => {
        if (genRef.current !== gen) return;
        setRowsByTab((current) => ({
          ...current,
          [pollType]: sortPollRows(polls.map(normalizeVoteHubPoll)),
        }));
        setStatus("loaded");
      })
      .catch((loadError) => {
        if (genRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load(tab);
  }, [load, tab]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
  }, [rows, selectedId]);

  const openSelected = useCallback(() => {
    if (!selected?.url) return;
    void rendererHost.openExternal(selected.url);
  }, [rendererHost, selected]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(tab);
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    return false;
  }, [load, openSelected, tab]);

  const columns = useMemo(() => createColumns(width), [width]);
  const renderCell = useCallback(
    (row: PollRow, column: PollColumn, _index: number, rowState: { selected: boolean }) =>
      renderPollCell(row, column, rowState.selected),
    [],
  );

  usePaneFooter("polls", () => ({
    info: [
      { id: "source", parts: [{ text: "VoteHub", tone: "muted" as const }] },
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
      ...(rows.length > 0 ? [{ id: "count", parts: [{ text: `${rows.length}`, tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(tab) },
      { id: "open", key: "o", label: "pen", onPress: openSelected, disabled: !selected?.url },
    ],
  }), [error, load, openSelected, rows.length, selected?.url, status, tab]);

  const tabs = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <Tabs
        tabs={TABS}
        activeValue={tab}
        onSelect={(value) => {
          setTab(value as PollTabId);
          setDetailOpen(false);
        }}
        compact
        variant="bare"
        focused={focused && !detailOpen}
      />
    </Box>
  );

  if (status === "loading" && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading polls..." />
        </Box>
      </Box>
    );
  }

  if (error && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Polls unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <DataTableStackView<PollRow, PollColumn>
        focused={focused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailContent={selected ? <PollDetail poll={selected} width={width} /> : null}
        detailTitle={selected?.subject}
        onRootKeyDown={handleKeyDown}
        onDetailKeyDown={handleKeyDown}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={() => setDetailOpen(true)}
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        columns={columns}
        items={rows}
        sortColumnId={null}
        sortDirection="asc"
        onHeaderClick={() => {}}
        getItemKey={(row) => row.id}
        renderCell={renderCell}
        emptyStateTitle="No polls in this category."
        emptyStateHint="Press r to refresh."
      />
    </Box>
  );
}
