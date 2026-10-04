import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FeedDataTableStackView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusLinkFooter,
  useQueryBarSearch,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
  type FeedDataTableItem,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import {
  useAsyncResource,
  useAutoRefresh,
  useDebouncedPluginPaneState,
  usePaneSettingValue,
  usePluginPaneState,
  useUpdatedAgo,
} from "../../../public/react";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { ClinicalTrialsClient, type ClinicalTrial } from "./client";
import { CLINICAL_TRIALS_PANE_ID } from "./types";

const EMPTY_ITEMS: ClinicalTrial[] = [];

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_PAGE_SIZE = 25;

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

function toFeedItems(trials: ClinicalTrial[]): FeedDataTableItem[] {
  return trials.map((trial) => ({
    id: trial.nctId,
    eyebrow: formatPhase(trial.phases),
    title: `${formatStatus(trial.status)} · ${trial.title} · ${trial.sponsor}`,
    timestamp: trialTimestamp(trial),
    detailTitle: trial.title,
    detailMeta: buildDetailMeta(trial),
    detailBody: trial.summary || "No summary was published for this study.",
  }));
}

export function TrialsPane({ width, height, focused }: PaneProps) {
  const client = useMemo(() => new ClinicalTrialsClient(), []);

  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);

  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const { active: searchFocused, focus: focusSearch, searchProps } = useQueryBarSearch();

  const loader = useCallback(async () => {
    const page = await client.listTrials({ term: query.trim() || undefined, pageSize: DEFAULT_PAGE_SIZE });
    return page.trials;
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const trials = data ?? EMPTY_ITEMS;

  const selectedTrial = trials.find((item) => item.nctId === selectedId) ?? trials[0] ?? null;
  const selectedIdx = selectedTrial ? trials.indexOf(selectedTrial) : 0;
  const openTrial = openItemId
    ? trials.find((trial) => trial.nctId === openItemId) ?? null
    : null;
  const detailTrial = openTrial ?? selectedTrial;
  // A controlled open id is the pane's to drop once that study leaves the page.
  useEffect(() => {
    if (openItemId && data && !openTrial) setOpenItemId(null);
  }, [data, openItemId, openTrial]);

  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery.trim());
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);

  const loading = refreshing && trials.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  const items = useMemo(() => toFeedItems(trials), [trials]);
  useAutoRefresh(lastUpdated, refresh);
  usePaneRefreshKey(() => void refresh(), { focused, enabled: !searchFocused && !openItemId });

  const detailUrl = detailTrial?.url || null;
  const info = useMemo<PaneFooterSegment[]>(
    () => (updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : []),
    [updatedAgo],
  );
  const hints = useMemo<PaneHint[]>(
    () => (openItemId ? [] : [{ id: "search", key: "/", label: "search", onPress: focusSearch }]),
    [focusSearch, openItemId],
  );
  usePaneStatusLinkFooter({
    registrationId: CLINICAL_TRIALS_PANE_ID,
    focused,
    url: detailUrl,
    loading: refreshing,
    error,
    info,
    hints,
    showOpenHint: !!detailUrl,
  });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const searchBar = (
    <QueryBar
      width={width}
      search={{
        value: query,
        onChange: updateQuery,
        placeholder: "condition, drug, or sponsor",
        focused: focused && !openItemId,
        debounceMs: SEARCH_DEBOUNCE_MS,
        normalizeValue: (value) => value.trim(),
        ...searchProps,
      }}
    />
  );

  if (loading || (error && trials.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <PaneStatusBody loading={loading} error={error} subject="Trials" />
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={searchBar}
      items={items}
      selectedIdx={selectedIdx}
      onSelect={(index) => setSelectedId(trials[index]?.nctId ?? null)}
      openItemId={openItemId}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Phase"
      titleLabel="Status · Title · Sponsor"
      emptyStateTitle={query.trim() ? `No trials match ${query.trim()}.` : "No trials loaded."}
      emptyStateHint="Press / to search…"
    />
  );
}
