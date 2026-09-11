import { Box, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  EmptyState,
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type FeedDataTableItem,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import type { NewsArticle } from "../../../news/types";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePopOutNewsArticle } from "../news/wire/news/pop-out";
import { ClinicalTrialsClient } from "./client";
import {
  CLINICAL_TRIALS_PLUGIN_ID,
  type ClinicalTrial,
} from "./types";

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

function formatDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toISOString().slice(0, 10);
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
    `Start ${formatDate(trial.startDate)} · Completion ${formatDate(trial.completionDate)}`,
    trial.enrollment != null ? `Enrollment: ${trial.enrollment}` : "Enrollment: —",
  ];
}

function buildDetailBody(trial: ClinicalTrial): string {
  const lines: string[] = [
    `**NCT ID:** ${trial.nctId}`,
    `**Status:** ${formatStatus(trial.status)}`,
    `**Phase:** ${formatPhase(trial.phases)}`,
    `**Sponsor:** ${trial.sponsor}`,
    `**Start:** ${formatDate(trial.startDate)}`,
    `**Completion:** ${formatDate(trial.completionDate)}`,
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
    detailTitle: trial.title,
    detailMeta: buildDetailMeta(trial),
    detailBody: buildDetailBody(trial),
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);

  const [trials, setTrials] = useState<ClinicalTrial[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (nextQuery: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      void client
        .listTrials({ term: nextQuery.trim() || undefined, pageSize: DEFAULT_PAGE_SIZE }, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return;
          setTrials(page.trials);
          setStatus("loaded");
          setLastUpdated(Date.now());
        })
        .catch((loadError) => {
          if (controller.signal.aborted) return;
          if (loadError instanceof Error && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setTrials([]);
          setStatus("error");
        });
    },
    [client],
  );

  useEffect(() => {
    const timeoutId = setTimeout(
      () => load(query),
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (trials.length > 0 && selectedIdx >= trials.length) {
      setSelectedIdx(Math.max(0, trials.length - 1));
    }
  }, [selectedIdx, setSelectedIdx, trials.length]);

  const selectedTrial = trials[selectedIdx] ?? null;
  const openTrial = openItemId
    ? trials.find((trial) => trial.nctId === openItemId) ?? null
    : null;
  const detailTrial = openTrial ?? selectedTrial;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery.trim());
      setSelectedIdx(0);
      setOpenItemId(null);
    },
    [setQuery, setSelectedIdx],
  );

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
        updateQuery("");
      }
      return;
    }
    if (event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      load(query);
    }
  }, { allowEditable: true, enabled: focused });

  const loading = status === "loading" && trials.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const items = useMemo(() => toFeedItems(trials), [trials]);
  useAutoRefresh(
    status === "loaded" ? lastUpdated : null,
    () => load(query),
    REFRESH_INTERVAL_MINUTES,
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
    url: error ? null : detailUrl,
    source: detailTrial ? detailTrial.sponsor : undefined,
    label: "trial",
    loading,
    error,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !error && !!detailUrl,
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(query) },
      ...(detailTrial && !error
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
      if (event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
        return true;
      }
      if (event.name === "r") {
        event.preventDefault?.();
        event.stopPropagation?.();
        load(query);
        return true;
      }
      return false;
    },
    [focusSearch, load, query],
  );

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="condition, drug, or sponsor"
      debounceMs={SEARCH_DEBOUNCE_MS}
      normalizeValue={trimSearchValue}
      onFocus={focusSearch}
      onBlur={blurSearch}
      onNavigateDown={blurSearch}
      onQueryChange={updateQuery}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner
            label={
              query.trim()
                ? `Searching trials for ${query.trim()}...`
                : "Loading trials..."
            }
          />
        </Box>
      </Box>
    );
  }

  if (error && trials.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title="Trials unavailable."
            message={error}
            hint="Press r to retry."
          />
        </Box>
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
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
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
