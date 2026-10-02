import { Box } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  FeedDataTableStackView,
  PaneListChrome,
  usePaneListSearch,
  PaneStatusBody,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import type { NewsArticle } from "../../../news/types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { ClinicalTrialsClient } from "./client";
import {
  CLINICAL_TRIALS_PLUGIN_ID,
  type ClinicalTrial,
} from "./types";

const EMPTY_ITEMS: ClinicalTrial[] = [];

const SEARCH_DEBOUNCE_MS = 250;
const REFRESH_INTERVAL_MINUTES = 15;
const DEFAULT_PAGE_SIZE = 25;

const trimSearchValue = (value: string) => value.trim();

function formatStatus(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatPhase(phases: string[]): string {
  if (phases.length === 0) return "No phase";
  const numbers = phases
    .map((phase) => phase.toUpperCase().replace("PHASE", "").trim())
    .filter(Boolean)
    .sort();
  return `Phase ${numbers.join("/")}`;
}

function formatDate(date: Date | null, precision: "year" | "month" | "day" = "day"): string {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, precision === "year" ? 4 : precision === "month" ? 7 : 10);
}

function trialTimestamp(trial: ClinicalTrial): Date | null {
  return trial.startDate ?? trial.firstSubmitDate;
}

function buildDetailMeta(trial: ClinicalTrial): string[] {
  return [
    `${trial.nctId} · ${formatStatus(trial.status)}`,
    `${formatPhase(trial.phases)}${trial.studyType ? ` · ${trial.studyType.toLowerCase()}` : ""}`,
    trial.sponsorClass ? `${trial.sponsor} (${trial.sponsorClass})` : trial.sponsor,
    trial.conditions.length > 0 ? trial.conditions.join(", ") : "No conditions listed",
    `Start ${formatDate(trial.startDate, trial.startDatePrecision)} · Completion ${formatDate(trial.completionDate, trial.completionDatePrecision)}`,
    trial.enrollment != null ? `Enrollment: ${trial.enrollment}` : "Enrollment: —",
  ];
}

function buildDetailBody(trial: ClinicalTrial): string {
  const lines: string[] = [
    `**NCT ID:** ${trial.nctId}`,
    `**Status:** ${formatStatus(trial.status)}`,
    `**Phase:** ${formatPhase(trial.phases)}`,
    `**Sponsor:** ${trial.sponsor}`,
    `**Start:** ${formatDate(trial.startDate, trial.startDatePrecision)}`,
    `**Completion:** ${formatDate(trial.completionDate, trial.completionDatePrecision)}`,
  ];
  if (trial.conditions.length > 0) {
    lines.push(`**Conditions:** ${trial.conditions.join(", ")}`);
  }
  lines.push("", trial.summary || "No summary was published for this study.");
  return lines.join("\n");
}

function toFeedItems(trials: ClinicalTrial[]): FeedDataTableItem[] {
  return trials.map((trial) => ({
    id: trial.nctId,
    eyebrow: formatPhase(trial.phases),
    title: `${formatStatus(trial.status)} · ${trial.title} · ${trial.sponsor}`,
    timestamp: trialTimestamp(trial),
    timestampKind: "date",
    datePrecision: trial.startDate ? trial.startDatePrecision : "day",
    detailTitle: trial.title,
    detailMeta: buildDetailMeta(trial),
    detailBody: trial.summary || "No summary was published for this study.",
  }));
}

function trialToArticle(trial: ClinicalTrial): NewsArticle {
  return {
    id: `clinical:${trial.nctId}`,
    title: trial.title,
    url: trial.url,
    source: "ClinicalTrials.gov",
    publishedAt: trialTimestamp(trial) ?? new Date(0),
    summary: trial.summary || `${formatPhase(trial.phases)} · ${formatStatus(trial.status)}`,
    topic: "trial",
    topics: ["trial", "clinical"],
    sectors: [],
    categories: ["Clinical Trials", formatPhase(trial.phases)],
    tickers: [],
    scores: { importance: 0, urgency: 0, marketImpact: 0, novelty: 0, confidence: 0 },
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "clinical-trials",
    body: buildDetailBody(trial),
  };
}

export function TrialsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new ClinicalTrialsClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);

  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const page = await client.listTrials({ term: query.trim() || undefined, pageSize: DEFAULT_PAGE_SIZE }, signal);
    return page.trials;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const trials = data ?? EMPTY_ITEMS;

  const selectedTrial = trials.find((item) => item.nctId === selectedId) ?? trials[0] ?? null;
  const openTrial = openItemId
    ? trials.find((trial) => trial.nctId === openItemId) ?? null
    : null;
  const detailTrial = openTrial ?? selectedTrial;

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery.trim());
      setSelectedId(null);
      setOpenItemId(null);
    },
    [setQuery, setSelectedId],
  );

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused: focused && !openItemId,
    value: query,
    onQueryChange: updateQuery,
    placeholder: "condition, drug, or sponsor",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: trimSearchValue,
  });

  useShortcut((event) => {
    if (!focused || openItemId || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const loading = refreshing && trials.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(trials), [trials]);
  const poll = useFeedPollInterval({ overrideConfigKey: "pollIntervalMinutes", defaultMinutes: REFRESH_INTERVAL_MINUTES });
  useAutoRefresh(
    lastUpdated,
    refresh, poll.intervalMinutes,
  );

  const detailUrl = detailTrial?.url || null;
  const popOutArticle = usePopOutNewsArticle(() => setOpenItemId(null));
  const popOutSelected = useCallback(() => {
    if (!detailTrial) return;
    popOutArticle(trialToArticle(detailTrial));
  }, [detailTrial, popOutArticle]);

  usePaneStatusLinkFooter({
    registrationId: CLINICAL_TRIALS_PLUGIN_ID,
    focused,
    url: detailUrl,
    loading: refreshing,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    trailingInfo: [...pollFooterTrailingInfo(!openItemId, poll.segment)],
    showOpenHint: !!detailUrl,
    hints: [
      ...(!openItemId ? [{ id: "search", key: "/", label: "search", onPress: focusSearch }] : []),
      ...(detailTrial
        ? [{ id: "pop-out", key: "p", label: "op out", onPress: popOutSelected }]
        : []),
    ],
  });

  const handleRootKeyDown = useCallback(
    (event: {
      name?: string;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }, context: { selectedIndex: number; itemCount: number }) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        focusSearch();
        return true;
      }
      if (handleSearchKey(event)) return true;
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
        return true;
      }
      return false;
    },
    [focusSearch, handleSearchKey, refresh],
  );

  const rootBefore = (
    <PaneListChrome width={width} focused={focused && !openItemId} search={search} />
  );

  if (loading || (error && trials.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <PaneStatusBody loading={loading} error={error} subject="Trials" onRetry={refresh} />
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={items}
      selectedItemId={selectedTrial?.nctId ?? null}
      onSelect={(index) => setSelectedId(trials[index]?.nctId ?? null)}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      onPopOut={(item) => {
        const trial = trials.find((entry) => entry.nctId === item.id) ?? detailTrial;
        if (trial) popOutArticle(trialToArticle(trial));
      }}
      sourceLabel="Phase"
      titleLabel="Status · Title · Sponsor"
      markdown
      emptyStateTitle={
        query.trim()
          ? `No trials match ${query.trim()}.`
          : "No trials loaded."
      }
      emptyStateHint="Press / to search…"
    />
  );
}
