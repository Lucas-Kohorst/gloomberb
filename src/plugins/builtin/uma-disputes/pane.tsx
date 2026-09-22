import { Box, TextAttributes, type InputRenderable } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  DataTableView,
  EmptyState,
  InputSearchBar,
  Spinner,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { nextSortPreference } from "../../../utils/sort-values";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { useAppSelector, usePaneSettingValue } from "../../../state/app/context";
import { selectByokKeys } from "../byok/store";
import { paneSearchHint, usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { currentBravadoCredentials, fetchUmaDisputes, UmaCredentialsError } from "./client";
import { disputeStage } from "./parse";
import {
  disputeTxUrl,
  filterDisputes,
  formatAnswer,
  formatUpdated,
  shortAddress,
  sortDisputes,
  type UmaSort,
} from "./model";
import {
  BRAVADO_UMA_BYOK_SERVICE_ID,
  BRAVADO_UMA_SECRET_SERVICE_ID,
  UMA_DISPUTES_PANE_ID,
  type UmaDisputeColumnId,
  type UmaQuestion,
} from "./types";

const SEARCH_DEBOUNCE_MS = 80;
const UNSORTED: UmaSort = { columnId: null, direction: "desc" };

const COLUMNS: DataTableColumn[] = [
  { id: "title", label: "MARKET", width: 36, align: "left", flexGrow: 1 },
  { id: "answer", label: "ANSWER", width: 10, align: "left" },
  { id: "disputer", label: "DISPUTER", width: 16, align: "left" },
  { id: "updated", label: "UPDATED", width: 12, align: "right" },
  { id: "stage", label: "STAGE", width: 10, align: "left" },
];

function renderCell(
  question: UmaQuestion,
  column: DataTableColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const color = rowState.selected ? colors.selectedText : undefined;
  switch (column.id as UmaDisputeColumnId) {
    case "title":
      return { text: question.title, color: color ?? colors.text };
    case "answer":
      return {
        text: formatAnswer(question),
        color: color ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    case "disputer":
      return { text: shortAddress(question.disputed?.disputer), color: color ?? colors.textDim };
    case "updated":
      return { text: formatUpdated(question.updatedMs), color: color ?? colors.textDim };
    case "stage":
      return { text: disputeStage(question) ?? "—", color: color ?? colors.text };
  }
}

export function UmaDisputesPane({ width, height, focused }: PaneProps) {
  const storedCredential = useAppSelector((state) => {
    const keys = selectByokKeys(state);
    const apiKey = keys.find((entry) => entry.serviceId === BRAVADO_UMA_BYOK_SERVICE_ID)?.apiKey ?? "";
    const apiSecret = keys.find((entry) => entry.serviceId === BRAVADO_UMA_SECRET_SERVICE_ID)?.apiKey ?? "";
    return `${apiKey}\0${apiSecret}`;
  });
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [questions, setQuestions] = useState<UmaQuestion[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() => (
    currentBravadoCredentials() ? "loading" : "error"
  ));
  const [error, setError] = useState<string | null>(() => (
    currentBravadoCredentials() ? null : "Bravado key required."
  ));
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [sort, setSort] = usePluginPaneState<UmaSort>("sort", UNSORTED);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    if (!currentBravadoCredentials()) {
      setQuestions([]);
      setStatus("error");
      setError("Bravado key required.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    void fetchUmaDisputes(controller.signal).then((next) => {
      if (abortRef.current !== controller) return;
      setQuestions(next);
      setStatus("loaded");
      setError(null);
      setLastUpdated(Date.now());
    }).catch((loadError: unknown) => {
      if (abortRef.current !== controller) return;
      if (loadError instanceof Error && loadError.name === "AbortError") return;
      setStatus("error");
      setError(loadError instanceof UmaCredentialsError
        ? "Bravado key required."
        : loadError instanceof Error ? loadError.message : "Bravado UMA request failed.");
    });
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load, storedCredential]);

  const filtered = useMemo(() => filterDisputes(questions, query), [questions, query]);
  const rows = useMemo(() => sortDisputes(filtered, sort), [filtered, sort]);
  const selected = rows.find((question) => question.questionId === selectedId) ?? rows[0] ?? null;
  const selectedUrl = selected ? disputeTxUrl(selected) : null;
  const missingKey = error === "Bravado key required.";
  const loading = status === "loading" && questions.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((token) => token + 1);
  }, []);
  const refresh = useCallback(() => {
    load();
  }, [load]);

  useAutoRefresh(status === "loaded" ? lastUpdated : null, refresh);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (isPlainKey(event, "/")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
    }
  }, { allowEditable: true, enabled: focused });

  const openSelected = usePaneStatusLinkFooter({
    registrationId: UMA_DISPUTES_PANE_ID,
    focused,
    url: missingKey ? null : selectedUrl,
    source: selectedUrl ? "Polygon" : undefined,
    label: "tx",
    loading,
    error: missingKey ? null : error,
    info: [
      ...(missingKey ? [{ id: "error", parts: [{ text: "key required", tone: "warning" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    showOpenHint: !missingKey && !!selectedUrl,
    hints: [paneSearchHint(focusSearch)],
  });

  const handleRootKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }, context: { selectedIndex: number }) => {
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
      refresh();
      return true;
    }
    return false;
  }, [focusSearch, refresh]);

  const searchBar = (
    <InputSearchBar
      value={query}
      focused={focused}
      active={searchFocused}
      width={width}
      focusToken={searchFocusToken}
      inputRef={searchInputRef}
      placeholder="market, address, or question id"
      debounceMs={SEARCH_DEBOUNCE_MS}
      onFocus={focusSearch}
      onBlur={() => setSearchFocused(false)}
      onNavigateDown={() => setSearchFocused(false)}
      onQueryChange={(value) => setQuery(value.trim())}
    />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading UMA disputes..." />
        </Box>
      </Box>
    );
  }

  if (error && questions.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState
            title={missingKey ? "Bravado key required." : "UMA disputes unavailable."}
            message={missingKey
              ? "Add the Bravado API key and HMAC secret in Keys."
              : error}
            hint={missingKey
              ? "Or set BRAVADO_API_KEY and BRAVADO_API_SECRET, then press r."
              : "Press r to retry."}
          />
        </Box>
      </Box>
    );
  }

  return (
    <DataTableView<UmaQuestion>
      focused={focused && !searchFocused}
      rootBefore={searchBar}
      rootWidth={width}
      rootHeight={height}
      selection={{
        kind: "id",
        selectedId: selected?.questionId ?? null,
        getId: (question) => question.questionId,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => openSelected()}
      onRootKeyDown={handleRootKeyDown}
      columns={COLUMNS}
      items={rows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as UmaDisputeColumnId;
        setSort((current) => nextSortPreference(current, next, {
          defaultDirection: (id) => (id === "updated" ? "desc" : "asc"),
        }));
      }}
      getItemKey={(question) => question.questionId}
      renderCell={renderCell}
      emptyStateTitle={query.trim() ? "No disputes match." : "No recent UMA disputes."}
      emptyStateHint="Press / to search."
    />
  );
}
