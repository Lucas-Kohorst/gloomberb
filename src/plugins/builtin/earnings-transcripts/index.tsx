import { useCallback, useEffect, useRef, useState } from "react";
import { Box, type InputRenderable } from "../../../ui";
import type { PluginModule } from "../plugin-module";
import type { PaneProps, PaneTemplateContext, PaneTemplateCreateOptions } from "../../../types/plugin";
import { usePaneTicker, usePaneSettingValue } from "../../../state/app/context";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  FeedDataTableStackView,
  InputSearchBar,
  Spinner,
  TickerEmptyState,
  type FeedDataTableItem,
} from "../../../components";
import { registerConnectionSource } from "../connections/register";
import { paneRefreshHint, paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { fetchEarningsTranscriptContent, fetchEarningsTranscripts } from "./client";
import type { EarningsTranscript } from "./types";

const EARNINGS_TRANSCRIPTS_PANE_ID = "earnings-transcripts";
const EARNINGS_TRANSCRIPTS_TEMPLATE_ID = "earnings-transcripts-pane";
const SEARCH_DEBOUNCE_MS = 250;
const trimSearchValue = (value: string) => value.trim();

/**
 * Build display items for the FeedDataTableStackView from transcript data.
 * Participants and key sections are folded into the detail body so the stack
 * view's detail pane shows metadata, participant list, and content.
 */
function toFeedItems(
  transcripts: EarningsTranscript[],
  selectedId: string | undefined,
): FeedDataTableItem[] {
  return transcripts.map((transcript) => {
    const selected = transcript.id === selectedId;
    const participantLines = selected && transcript.participants.length > 0
      ? ["Participants", ...transcript.participants.map((p) => `${p.name} — ${p.role}`)]
      : [];
    const sectionLines = selected && transcript.sections.length > 0
      ? ["Key Sections", ...transcript.sections.map((s, i) => `[${i + 1}] ${s.text.slice(0, 200)}`)]
      : [];
    const detailBody = selected
      ? [
        ...participantLines,
        ...(participantLines.length > 0 ? [""] : []),
        ...sectionLines,
        ...(sectionLines.length > 0 ? [""] : []),
        transcript.body || "Loading filing content...",
      ].join("\n")
      : "";

    const meta: string[] = [];
    if (transcript.date) meta.push(`Filed ${transcript.date}`);
    if (transcript.quarter) meta.push(transcript.quarter);
    if (transcript.company) meta.push(transcript.company);
    meta.push(`Accession ${transcript.id}`);

    return {
      id: transcript.id,
      eyebrow: transcript.form,
      title: transcript.title,
      timestamp: transcript.date || null,
      detailTitle: transcript.title,
      detailMeta: meta,
      detailBody,
    };
  });
}

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function useOpenTranscriptContent(
  openItemId: string | null,
  transcripts: EarningsTranscript[],
  setTranscripts: (updater: (current: EarningsTranscript[]) => EarningsTranscript[]) => void,
): void {
  const contentGenRef = useRef(0);
  useEffect(() => {
    if (!openItemId) return;
    const current = transcripts.find((transcript) => transcript.id === openItemId);
    if (!current || current.contentLoaded) return;
    contentGenRef.current += 1;
    const gen = contentGenRef.current;
    void fetchEarningsTranscriptContent(current)
      .then((next) => {
        if (contentGenRef.current !== gen) return;
        setTranscripts((list) => list.map((item) => item.id === next.id ? next : item));
      })
      .catch(() => {
        if (contentGenRef.current !== gen) return;
        setTranscripts((list) => list.map((item) => (
          item.id === openItemId
            ? {
              ...item,
              contentLoaded: true,
              body: "Filing content was not available for this document.",
            }
            : item
        )));
      });
  }, [openItemId, setTranscripts, transcripts]);
}

/* ------------------------------------------------------------------ */
/* Standalone pane (command-bar: TRANS <symbol>)                      */
/* ------------------------------------------------------------------ */

function EarningsTranscriptsPane({ width, height, focused }: PaneProps) {
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [transcripts, setTranscripts] = useState<EarningsTranscript[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      setTranscripts([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    void fetchEarningsTranscripts(trimmed)
      .then((data) => {
        if (abortRef.current !== controller) return;
        setTranscripts(data);
        setStatus("loaded");
      })
      .catch((loadError) => {
        if (abortRef.current !== controller) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setTranscripts([]);
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      load(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timeoutId);
  }, [load, query]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const loading = status === "loading" && transcripts.length === 0;
  useOpenTranscriptContent(openItemId, transcripts, setTranscripts);
  const selectedTranscript = openItemId
    ? transcripts.find((t) => t.id === openItemId) ?? null
    : null;

  useEffect(() => {
    if (transcripts.length > 0 && selectedIdx >= transcripts.length) {
      setSelectedIdx(Math.max(0, transcripts.length - 1));
    }
  }, [transcripts.length, selectedIdx, setSelectedIdx]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);
  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedIdx(0);
    setOpenItemId(null);
  }, [setQuery, setSelectedIdx]);

  useShortcut((event) => {
    if (!focused || openItemId) return;
    if (searchFocused) {
      if (isPlainKey(event, "escape")) {
        event.stopPropagation?.();
        event.preventDefault?.();
        setSearchFocused(false);
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

  const openUrl = !error ? selectedTranscript?.url ?? null : null;
  usePaneStatusLinkFooter({
    registrationId: EARNINGS_TRANSCRIPTS_PANE_ID,
    focused,
    url: openUrl,
    source: selectedTranscript?.form,
    label: "transcript",
    loading,
    error,
    showOpenHint: !error && !!openUrl,
    hints: [
      paneSearchHint(focusSearch),
      paneRefreshHint(() => load(query)),
    ],
  });

  const handleRootKeyDown = useCallback((event: { name?: string; preventDefault?: () => void; stopPropagation?: () => void }, context: { selectedIndex: number }) => {
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
  }, [focusSearch, load, query]);

  const rootBefore = (
    <InputSearchBar
      value={query}
      focused={focused && !openItemId}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="ticker (e.g. AAPL)"
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
          <Spinner label={`Searching earnings transcripts for ${query.trim()}...`} />
        </Box>
      </Box>
    );
  }

  const trimmedQuery = query.trim();

  if (error && transcripts.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <TickerEmptyState
          kind="transcripts"
          symbol={trimmedQuery || null}
          detail="earnings transcripts"
          error={error}
        />
      </Box>
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused && !searchFocused}
      rootBefore={rootBefore}
      items={toFeedItems(transcripts, openItemId ?? undefined)}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      onRootKeyDown={handleRootKeyDown}
      sourceLabel="Form"
      titleLabel="Transcript"
      emptyStateTitle={trimmedQuery ? "No transcripts data" : "Enter a ticker to load transcripts."}
      emptyStateMessage={trimmedQuery ? `${trimmedQuery} has no earnings transcripts.` : undefined}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Ticker Research tab                                                */
/* ------------------------------------------------------------------ */

function EarningsTranscriptsTab({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { ticker } = usePaneTicker();
  const symbol = ticker?.metadata.ticker ?? null;
  const [transcripts, setTranscripts] = useState<EarningsTranscript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useDebouncedPluginPaneState<number>("selectedIdx", 0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setTranscripts([]);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchEarningsTranscripts(symbol)
      .then((data) => {
        setTranscripts(data);
        setLoading(false);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setTranscripts([]);
        setLoading(false);
      });
  }, [symbol]);

  useOpenTranscriptContent(openItemId, transcripts, setTranscripts);
  const selectedTranscript = openItemId
    ? transcripts.find((t) => t.id === openItemId) ?? null
    : null;
  const openUrl = !error ? selectedTranscript?.url ?? null : null;

  usePaneStatusLinkFooter({
    registrationId: "earnings-transcripts-tab",
    focused,
    url: openUrl,
    source: selectedTranscript?.form,
    label: "transcript",
    loading,
    error,
    showOpenHint: !error && !!openUrl,
  });

  if (!ticker) return <TickerEmptyState kind="transcripts" symbol={null} detail="earnings transcripts" />;
  if (loading && transcripts.length === 0) return <Spinner label="Loading transcripts..." />;
  if (transcripts.length === 0) {
    return (
      <TickerEmptyState
        kind="transcripts"
        symbol={symbol}
        detail="earnings transcripts"
        error={error}
      />
    );
  }

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={toFeedItems(transcripts, openItemId ?? undefined)}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      onOpenItemIdChange={setOpenItemId}
      sourceLabel="Form"
      titleLabel="Transcript"
      emptyStateTitle="No transcripts data"
      emptyStateMessage={symbol ? `${symbol} has no earnings transcripts.` : undefined}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Module                                                             */
/* ------------------------------------------------------------------ */

let disposeConnection: (() => void) | null = null;

export const earningsTranscriptsModule: PluginModule = {
  panes: [
    {
      id: EARNINGS_TRANSCRIPTS_PANE_ID,
      name: "Earnings Transcripts",
      icon: "T",
      component: EarningsTranscriptsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],

  paneTemplates: [
    {
      id: EARNINGS_TRANSCRIPTS_TEMPLATE_ID,
      paneId: EARNINGS_TRANSCRIPTS_PANE_ID,
      label: "Earnings Transcripts",
      description: "Earnings call transcripts (8-K proxy) for a ticker. Open TRANS AAPL to jump there.",
      keywords: ["transcript", "earnings", "call", "8-k", "trans", "quarterly", "remarks"],
      shortcut: {
        prefix: "TRANS",
        argPlaceholder: "ticker",
        argKind: "ticker",
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const query = queryFromTemplateOptions(options);
        return {
          instanceId: query
            ? `${EARNINGS_TRANSCRIPTS_PANE_ID}:${encodeURIComponent(query.toUpperCase()).replace(/%/g, "~")}`
            : `${EARNINGS_TRANSCRIPTS_PANE_ID}:latest`,
          title: query ? `TRANS ${query.toUpperCase()}` : "Earnings Transcripts",
          placement: "floating" as const,
          binding: { kind: "none" as const },
          settings: { query },
        };
      },
    },
  ],

  setup(ctx) {
    disposeConnection = registerConnectionSource({
      id: "earnings-transcripts",
      name: "Earnings Transcripts",
      kind: "api",
      pluginId: "earnings-transcripts",
      priority: 600,
    });
    ctx.registerTickerResearchTab({
      id: "earnings-transcripts",
      name: "Transcripts",
      order: 46,
      component: EarningsTranscriptsTab,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};
