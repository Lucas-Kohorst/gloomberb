import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  nextStackSortPreference,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";

import { colors, priceColor } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import { openUrl } from "../../../components/ui/external-link";
import type { PaneProps } from "../../../types/plugin";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { paneRefreshHint, paneSearchHint } from "../shared/pane-footer";
import { useGraphChartPopOut } from "../shared/graph-pop-out";
import { usePaneSettingValue } from "../../../state/app/context";
import { encodeSortPreference } from "../../../components/data-table/sort-settings";
import { resolveVisibleColumns } from "../../../components/data-table/column-settings";
import {
  getPollsPaneSettings,
  POLL_COLUMN_DEFS,
  POLL_COLUMN_IDS,
  type PollColumnId,
} from "./settings";
import { fetchVoteHubPolls } from "./client";

import {
  computePollAverages,
  computePollsterAverages,
  computePollsterHouseSeries,
  computePollTrend,
  DEFAULT_POLL_SORT,
  filterPollRows,
  formatPollDate,
  normalizeVoteHubPoll,
  pollRaceKey,
  sortPollRows,
  type PollSortColumnId,
} from "./normalize";
import {
  loadPollRaceMarketOverlay,
  type PollRaceMarketOverlay,
} from "./overlay";
import type { PollAnalysisGroup, PollAnalysisView, PollDetailTab, PollRow, PollTabId } from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface PollColumn extends DataTableColumn {
  id: PollColumnId;
}

const TABS: Array<{ value: PollTabId; label: string }> = [
  { value: "all", label: "All" },
  { value: "approval", label: "Approval" },
  { value: "favorability", label: "Favorability" },
  { value: "generic-ballot", label: "Generic" },
  { value: "us-senator", label: "Senate" },
  { value: "governor", label: "Governor" },
  { value: "us-representative", label: "House" },
];

const DETAIL_TABS: Array<{ value: PollDetailTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "trend", label: "Trend" },
  { value: "pollsters", label: "Pollsters" },
];

const ANALYSIS_TABS: Array<{ value: PollAnalysisGroup; label: string }> = [
  { value: "house", label: "Pollster" },
  { value: "race", label: "Race" },
];

const RECENT_POLL_COUNT = 10;

/**
 * Maps a poll answer label to a semantic color: approve/yes → positive,
 * disapprove/no → negative, everything else stays neutral. A leading
 * "approve" poll at 40% is still semantically positive, so this is label-based
 * (not probability-based like prediction markets).
 */
function answerChoiceColor(choice: string): string | undefined {
  const normalized = choice.trim().toLowerCase();
  if (/\b(approve|yes|favor|support|positive)\b/.test(normalized)) return colors.positive;
  if (/\b(disapprove|no|oppose|against|negative|unfavor)\b/.test(normalized)) return colors.negative;
  return undefined;
}

function createColumns(width: number, columnIds: readonly PollColumnId[]): PollColumn[] {
  const layout: Record<PollColumnId, { label: string; width: number; flex?: boolean }> = {
    date: { label: "DATE", width: 8 },
    subject: { label: "SUBJECT", width: 12, flex: true },
    pollster: { label: "POLLSTER", width: 14 },
    pop: { label: "POP", width: 4 },
    result: { label: "RESULT", width: 22 },
  };
  const ids = resolveVisibleColumns(POLL_COLUMN_DEFS, columnIds, POLL_COLUMN_IDS)
    .map((column) => column.id as PollColumnId);
  const visible = ids.length > 0 ? ids : [...POLL_COLUMN_IDS];
  const flexId = visible.includes("subject") ? "subject" : visible[0];
  const fixedWidth = visible.filter((id) => id !== flexId).reduce((sum, id) => sum + layout[id]!.width, 0);
  const flexWidth = Math.max(layout[flexId ?? "subject"]!.width, width - fixedWidth - visible.length - 3);
  return visible.map((id) => ({
    id,
    label: layout[id]!.label,
    width: id === flexId ? flexWidth : layout[id]!.width,
    align: "left",
  }));
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

function AnswerBar({ pct, color, maxPct, width }: { pct: number; color: string; maxPct: number; width: number }) {
  const barWidth = maxPct > 0 ? Math.max(1, Math.round((pct / maxPct) * width)) : 0;
  return (
    <Box flexDirection="row" height={1} gap={1}>
      <Box width={barWidth} backgroundColor={color} />
      <Box flexGrow={1} />
    </Box>
  );
}

function PollOverview({ poll, allRows, width }: { poll: PollRow; allRows: PollRow[]; width: number }) {
  const lineWidth = Math.max(12, width - 2);
  const maxPct = Math.max(...poll.answers.map((a) => a.pct), 1);
  const labelWidth = Math.min(16, Math.floor(lineWidth * 0.35));
  const barWidth = Math.max(10, lineWidth - labelWidth - 12);

  const averages = useMemo(
    () => computePollAverages(allRows, pollRaceKey(poll), RECENT_POLL_COUNT),
    [allRows, poll],
  );
  const maxAvg = Math.max(...averages.map((a) => a.avgPct), 1);

  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text fg={colors.textDim}>
          {poll.pollTypeLabel}
          {poll.sponsors.length > 0 ? ` · ${poll.sponsors.join(", ")}` : ""}
        </Text>
        <Text fg={colors.textDim}>
          {formatPollDate(poll.startDate)}–{formatPollDate(poll.endDate)}
          {` · ${poll.pollster} · ${poll.population}`}
          {poll.sampleSize != null ? ` · n=${poll.sampleSize.toLocaleString("en-US")}` : ""}
          {poll.marginOfError != null ? ` · ±${poll.marginOfError}%` : ""}
        </Text>
        {poll.partisan ? <Text fg={colors.textMuted}>Partisan: {poll.partisan}</Text> : null}
        {poll.internal ? <Text fg={colors.textMuted}>Internal poll</Text> : null}

        <Box height={1} />
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>This poll</Text>
        {poll.answers.map((answer) => {
          const choiceColor = answerChoiceColor(answer.choice);
          return (
          <Box key={answer.choice} flexDirection="row" height={1} gap={2}>
            <Box width={labelWidth}>
              <Text fg={choiceColor ?? colors.text} wrapMode="ellipsis">{answer.choice}</Text>
            </Box>
            <Box width={4} justifyContent="flex-end" flexDirection="row">
              <Text fg={choiceColor ?? (poll.leadChoice === answer.choice ? colors.textBright : colors.textDim)} attributes={TextAttributes.BOLD}>
                {Number.isInteger(answer.pct) ? `${answer.pct}` : answer.pct.toFixed(1)}
              </Text>
            </Box>
            <Box width={barWidth}>
              <AnswerBar
                pct={answer.pct}
                color={choiceColor ?? (poll.leadChoice === answer.choice ? colors.positive : colors.border)}
                maxPct={maxPct}
                width={barWidth}
              />
            </Box>
          </Box>
          );
        })}

        {averages.length > 0 && (
          <>
            <Box height={1} />
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              {RECENT_POLL_COUNT}-poll weighted avg
            </Text>
            {averages.map((avg) => {
              const avgColor = answerChoiceColor(avg.choice);
              return (
              <Box key={avg.choice} flexDirection="row" height={1} gap={2}>
                <Box width={labelWidth}>
                  <Text fg={avgColor ?? colors.text} wrapMode="ellipsis">{avg.choice}</Text>
                </Box>
                <Box width={4} justifyContent="flex-end" flexDirection="row">
                  <Text fg={avgColor ?? colors.textBright} attributes={TextAttributes.BOLD}>
                    {avg.avgPct.toFixed(1)}
                  </Text>
                </Box>
                <Box width={barWidth}>
                  <AnswerBar
                    pct={avg.avgPct}
                    color={avgColor ?? colors.textBright}
                    maxPct={maxAvg}
                    width={barWidth}
                  />
                </Box>
                <Text fg={colors.textDim}>{avg.pollCount}</Text>
              </Box>
              );
            })}
          </>
        )}
      </Box>
    </ScrollBox>
  );
}

function PollTrend({
  poll,
  allRows,
  width,
  height,
  focused,
  group,
  onGroupChange,
}: {
  poll: PollRow;
  allRows: PollRow[];
  width: number;
  height: number;
  focused: boolean;
  group: PollAnalysisGroup;
  onGroupChange: (group: PollAnalysisGroup) => void;
}) {
  const leadingChoice = poll.leadChoice ?? poll.answers[0]?.choice ?? null;
  const raceKey = pollRaceKey(poll);
  const [market, setMarket] = useState<PollRaceMarketOverlay | null>(null);
  const [marketStatus, setMarketStatus] = useState<"idle" | "loading" | "loaded" | "missing">("idle");

  const racePoints = useMemo(
    () => leadingChoice ? computePollTrend(allRows, raceKey, leadingChoice) : [],
    [allRows, raceKey, leadingChoice],
  );
  const housePoints = useMemo(
    () => leadingChoice
      ? computePollsterHouseSeries(allRows, raceKey, poll.pollster, leadingChoice)
      : [],
    [allRows, raceKey, poll.pollster, leadingChoice],
  );

  useEffect(() => {
    if (!leadingChoice) {
      setMarket(null);
      setMarketStatus("idle");
      return;
    }
    let cancelled = false;
    setMarketStatus("loading");
    loadPollRaceMarketOverlay(poll, leadingChoice)
      .then((overlay) => {
        if (cancelled) return;
        setMarket(overlay);
        setMarketStatus(overlay ? "loaded" : "missing");
      })
      .catch(() => {
        if (cancelled) return;
        setMarket(null);
        setMarketStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [poll, leadingChoice]);

  const points = group === "house" ? housePoints : racePoints;

  if (!leadingChoice || points.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <EmptyState title="No trend data." hint="Not enough polls for this race." />
      </Box>
    );
  }

  if (points.length < 2) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <EmptyState
          title="Not enough data for a trend."
          hint={group === "house" ? "This pollster needs 2 prints, or switch to Race." : "Need at least 2 polls."}
        />
      </Box>
    );
  }

  const rangeLabel = `${formatPollDate(points[0]!.date)}–${formatPollDate(points[points.length - 1]!.date)}`;
  const marketLabel = marketStatus === "loading"
    ? "pm…"
    : market
      ? market.label
      : null;

  return (
    <Box flexDirection="column" height={height}>
      <Box height={1} flexShrink={0} overflow="hidden">
        <Tabs
          tabs={ANALYSIS_TABS}
          activeValue={group}
          onSelect={(value) => onGroupChange(value as PollAnalysisGroup)}
          compact
          focused={focused}
        />
      </Box>
      <Box flexDirection="row" height={1} paddingX={1} gap={2} flexShrink={0}>
        <Text fg={colors.textDim}>
          {leadingChoice}
          {group === "house" ? ` · ${poll.pollster}` : ""}
          {` · ${points.length} polls · ${rangeLabel}`}
        </Text>
        {marketLabel ? <Text fg={colors.warning} wrapMode="ellipsis">{marketLabel}</Text> : null}
      </Box>
      <Box flexGrow={1} justifyContent="center">
        <EmptyState title="Graph this poll." hint="Press [g] to open the chart pop-out." />
      </Box>
    </Box>
  );
}

function PollPollsters({
  poll,
  allRows,
  width,
}: {
  poll: PollRow;
  allRows: PollRow[];
  width: number;
}) {
  const leadingChoice = poll.leadChoice ?? poll.answers[0]?.choice ?? null;
  const pollsters = useMemo(
    () => computePollsterAverages(allRows, pollRaceKey(poll), leadingChoice),
    [allRows, poll, leadingChoice],
  );

  if (pollsters.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center">
        <EmptyState title="No pollster data." hint="Not enough polls for this subject." />
      </Box>
    );
  }

  const lineWidth = Math.max(12, width - 2);
  const pollsterWidth = Math.min(22, Math.floor(lineWidth * 0.4));
  const numWidth = 4;
  const sampleWidth = 8;
  const barWidth = Math.max(8, lineWidth - pollsterWidth - numWidth - sampleWidth - 8);
  const maxAvg = Math.max(...pollsters.map((p) => p.avgPct), 1);

  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="row" height={1} gap={2}>
          <Box width={pollsterWidth}>
            <Text fg={colors.textDim}>POLLSTER</Text>
          </Box>
          <Box width={numWidth} justifyContent="flex-end" flexDirection="row">
            <Text fg={colors.textDim}>AVG</Text>
          </Box>
          <Box width={sampleWidth} justifyContent="flex-end" flexDirection="row">
            <Text fg={colors.textDim}>N</Text>
          </Box>
          <Box width={3} justifyContent="flex-end" flexDirection="row">
            <Text fg={colors.textDim}>#</Text>
          </Box>
        </Box>
        {pollsters.map((entry) => (
          <Box key={entry.pollster} flexDirection="row" height={1} gap={2}>
            <Box width={pollsterWidth}>
              <Text fg={colors.text} wrapMode="ellipsis">{entry.pollster}</Text>
            </Box>
            <Box width={numWidth} justifyContent="flex-end" flexDirection="row">
              <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                {entry.avgPct.toFixed(1)}
              </Text>
            </Box>
            <Box width={sampleWidth} justifyContent="flex-end" flexDirection="row">
              <Text fg={colors.textDim}>
                {entry.totalSample > 0 ? entry.totalSample.toLocaleString("en-US") : "—"}
              </Text>
            </Box>
            <Box width={3} justifyContent="flex-end" flexDirection="row">
              <Text fg={colors.textDim}>{entry.count}</Text>
            </Box>
            <Box width={barWidth}>
              <AnswerBar
                pct={entry.avgPct}
                color={colors.positive}
                maxPct={maxAvg}
                width={barWidth}
              />
            </Box>
          </Box>
        ))}
      </Box>
    </ScrollBox>
  );
}

function PollDetail({
  poll,
  allRows,
  width,
  height,
  focused,
  detailTab,
  analysisGroup,
  onDetailTabChange,
  onAnalysisGroupChange,
}: {
  poll: PollRow;
  allRows: PollRow[];
  width: number;
  height: number;
  focused: boolean;
  detailTab: PollDetailTab;
  analysisGroup: PollAnalysisGroup;
  onDetailTabChange: (tab: PollDetailTab) => void;
  onAnalysisGroupChange: (group: PollAnalysisGroup) => void;
}) {
  const tabs = (
    <Box paddingBottom={1}>
      <Tabs
        tabs={DETAIL_TABS}
        activeValue={detailTab}
        onSelect={(v) => onDetailTabChange(v as PollDetailTab)}
        compact
      />
    </Box>
  );

  const contentHeight = Math.max(height - 2, 1);

  if (detailTab === "trend") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <PollTrend
          poll={poll}
          allRows={allRows}
          width={width}
          height={contentHeight}
          focused={focused}
          group={analysisGroup}
          onGroupChange={onAnalysisGroupChange}
        />
      </Box>
    );
  }

  if (detailTab === "pollsters") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <PollPollsters poll={poll} allRows={allRows} width={width} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <PollOverview poll={poll} allRows={allRows} width={width} />
    </Box>
  );
}

export function PollsPane({ focused, width, height }: PaneProps) {
  const [tab, setTab] = usePaneSettingValue<PollTabId>("defaultTab", "all");
  const [columnIds] = usePaneSettingValue<unknown>("columnIds", POLL_COLUMN_IDS);
  const [sortValue, setSortValue] = usePaneSettingValue<unknown>("sort", encodeSortPreference(DEFAULT_POLL_SORT));
  const paneSettings = getPollsPaneSettings({ defaultTab: tab, columnIds, sort: sortValue });
  const resolvedTab = paneSettings.defaultTab;
  const [rowsByTab, setRowsByTab] = useState<Partial<Record<PollTabId, PollRow[]>>>({});
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<PollDetailTab>("overview");
  const [analysisGroup, setAnalysisGroup] = useState<PollAnalysisGroup>("race");
  const [analysisView, setAnalysisView] = useState<PollAnalysisView>("overlay");
  const sortPreference = paneSettings.sort;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const genRef = useRef(0);

  const allRows = rowsByTab[resolvedTab] ?? [];
  const filteredRows = useMemo(() => filterPollRows(allRows, searchQuery), [allRows, searchQuery]);
  const rows = useMemo(() => sortPollRows(filteredRows, sortPreference), [filteredRows, sortPreference]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

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
          [pollType]: polls.map(normalizeVoteHubPoll),
        }));
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (genRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load(resolvedTab);
  }, [load, resolvedTab]);

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
    openUrl(selected.url);
  }, [selected]);
  const popOutChart = useGraphChartPopOut();
  const graphSelected = useCallback(() => {
    if (!selected) return;
    const choice = selected.leadChoice ?? selected.answers[0]?.choice;
    if (!choice) return;
    popOutChart(`POLL:${selected.subject}:${choice}`);
  }, [popOutChart, selected]);

  const handleRootKeyDown = useCallback((
    event: DataTableKeyEvent,
    context: DataTableRootKeyContext,
  ) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(resolvedTab);
      return true;
    }
    if (isPlainKey(event, "g")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selected?.url) openUrl(selected.url);
      return true;
    }
    return false;
  }, [focusSearch, graphSelected, load, openSelected, selected?.url, resolvedTab]);

  useShortcut((event) => {
    if (!focused || detailOpen || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !detailOpen && !searchFocused });

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "h") || event.name === "left") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDetailTab((current) => {
        const idx = DETAIL_TABS.findIndex((t) => t.value === current);
        if (idx <= 0) return DETAIL_TABS[DETAIL_TABS.length - 1]!.value;
        return DETAIL_TABS[idx - 1]!.value;
      });
      return true;
    }
    if (isPlainKey(event, "l") || event.name === "right") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setDetailTab((current) => {
        const idx = DETAIL_TABS.findIndex((t) => t.value === current);
        if (idx < 0 || idx >= DETAIL_TABS.length - 1) return DETAIL_TABS[0]!.value;
        return DETAIL_TABS[idx + 1]!.value;
      });
      return true;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(resolvedTab);
      return true;
    }
    if (isPlainKey(event, "g")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selected?.url) openUrl(selected.url);
      return true;
    }
    if (detailTab === "trend" && isPlainKey(event, "t")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setAnalysisGroup((current) => current === "house" ? "race" : "house");
      return true;
    }
    return false;
  }, [graphSelected, load, selected?.url, resolvedTab, detailTab]);

  const columns = useMemo(() => createColumns(width, paneSettings.columnIds), [paneSettings.columnIds, width]);
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  useAutoRefresh(status === "loaded" ? lastUpdated : null, () => load(resolvedTab));
  const renderCell = useCallback(
    (row: PollRow, column: PollColumn, _index: number, rowState: { selected: boolean }) =>
      renderPollCell(row, column, rowState.selected),
    [],
  );

  const baseHints = useMemo(() => {
    return detailOpen
      ? [
          paneRefreshHint(() => load(resolvedTab)),
          { id: "open", key: "o", label: "pen", onPress: openSelected, disabled: !selected?.url },
        ]
      : [
          paneSearchHint(focusSearch),
          paneRefreshHint(() => load(resolvedTab)),
          { id: "open", key: "o", label: "pen", onPress: openSelected, disabled: !selected?.url },
        ];
  }, [detailOpen, load, openSelected, focusSearch, selected?.url, resolvedTab]);

  const analysisHints = useMemo(() => {
    if (!detailOpen) return [];
    if (detailTab === "trend") {
      return [
        {
          id: "group",
          key: "t",
          label: "ype",
          onPress: () => setAnalysisGroup((current) => current === "house" ? "race" : "house"),
        },
        {
          id: "view",
          key: "v",
          label: "iew",
          onPress: () => setAnalysisView((current) => current === "overlay" ? "scatter" : "overlay"),
        },
      ];
    }
    return [];
  }, [detailOpen, detailTab, setAnalysisGroup, setAnalysisView]);

  const hints = useMemo(() => {
    const graphHint = [{ id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !selected }];
    return [...graphHint, ...analysisHints, ...baseHints];
  }, [graphSelected, selected, analysisHints, baseHints]);

  usePaneFooter("polls", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(searchQuery.trim() ? [{ id: "search", parts: [{ text: `search: ${searchQuery.trim()}`, tone: "value" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
      ...(detailOpen && detailTab === "trend"
        ? [{ id: "analysis", parts: [{ text: analysisGroup === "house" ? "pollster" : "race", tone: "value" as const }] }]
        : []),
    ],
    hints,
  }), [
    hints,
    error,
    status,
    searchQuery,
    updatedAgo,
    detailOpen,
    detailTab,
    analysisGroup,
  ]);

  const tabs = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <Tabs
        tabs={TABS}
        activeValue={resolvedTab}
        onSelect={(value) => {
          setTab(value as PollTabId);
          setDetailOpen(false);
          setSearchQuery("");
        }}
        compact
        variant="bare"
        focused={focused && !detailOpen && !searchFocused}
      />
    </Box>
  );

  const searchBar = (
    <InputSearchBar
      value={searchQuery}
      focused={focused && !detailOpen}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="subject or pollster"
      debounceMs={80}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={setSearchQuery}
    />
  );

  if (status === "loading" && allRows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading polls..." />
        </Box>
      </Box>
    );
  }

  if (error && allRows.length === 0) {
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
        focused={focused && !searchFocused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailContent={
          selected ? (
            <PollDetail
              poll={selected}
              allRows={allRows}
              width={width}
              height={Math.max(height - 1, 1)}
              focused={focused && !searchFocused}
              detailTab={detailTab}
              analysisGroup={analysisGroup}
              onDetailTabChange={setDetailTab}
              onAnalysisGroupChange={setAnalysisGroup}
            />
          ) : null
        }
        detailTitle={selected?.subject}
        rootBefore={searchBar}
        onRootKeyDown={handleRootKeyDown}
        onDetailKeyDown={handleDetailKeyDown}
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={() => {
          blurSearch();
          setDetailOpen(true);
        }}
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        columns={columns}
        items={rows}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          const next = columnId as PollSortColumnId;
          setSortValue(encodeSortPreference(nextStackSortPreference(
            sortPreference,
            next,
            next === "subject" || next === "pollster" || next === "pop" ? "asc" : "desc",
          )));
        }}
        getItemKey={(row) => row.id}
        renderCell={renderCell}
        emptyStateTitle={searchQuery.trim() ? "No matching polls." : resolvedTab === "all" ? "No polls." : "No polls in this category."}
        emptyStateHint={searchQuery.trim() ? "Clear search or press r to refresh." : "Press r to refresh."}
      />
    </Box>
  );
}
