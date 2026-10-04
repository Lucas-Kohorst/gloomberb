import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BulletList,
  DataTableStackView,
  DetailScrollBody,
  KeyValueRow,
  PaneStatusBody,
  Prose,
  QueryBar,
  Section,
  usePaneStatusLinkFooter,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
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
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, type ScrollBoxRenderable } from "../../../ui";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { compareSortValues, nextHeaderSort, type SortPreference } from "../../../utils/sort-values";
import { CommentLettersClient, toCommentLetterRow } from "./client";
import { COMMENT_LETTERS_PANE_ID, type CommentLetterRow, type CommentLetterSeverity } from "./types";

const EMPTY_ROWS: CommentLetterRow[] = [];
const SEARCH_DEBOUNCE_MS = 350;
const LETTER_LIST_LIMIT = 50;
const PLACEHOLDER_REASONS = new Set(["no flagged topics", "no text"]);

type ColumnId = "filed" | "form" | "severity" | "company" | "topic";
type LetterColumn = DataTableColumn & { id: ColumnId };

const severityColor = (level: CommentLetterSeverity): string => {
  if (level === "high") return colors.negative;
  if (level === "medium") return colors.warning;
  return colors.textMuted;
};

const letterColumns = (width: number): LetterColumn[] => {
  const topic = width >= 72;
  return [
    { id: "filed", label: "Filed", width: 10, align: "left" },
    { id: "form", label: "Form", width: 8, align: "left" },
    { id: "severity", label: "Severity", width: 8, align: "left" },
    { id: "company", label: "Company", width: topic ? 24 : 16, align: "left", flexGrow: 1 },
    ...(topic ? [{ id: "topic" as const, label: "Topic", width: 20, align: "left" as const, flexGrow: 2 }] : []),
  ];
};

const sortValue = (row: CommentLetterRow, columnId: ColumnId): string | number | null => {
  switch (columnId) {
    case "filed":
      return row.filedAt || null;
    case "form":
      return row.form;
    case "severity":
      return row.score;
    case "company":
      return row.company;
    case "topic":
      return row.topic || null;
  }
};

const sortRows = (rows: CommentLetterRow[], sort: SortPreference<ColumnId>): CommentLetterRow[] => {
  if (!sort.columnId) return rows;
  const columnId = sort.columnId;
  return [...rows].sort((left, right) =>
    compareSortValues(sortValue(left, columnId), sortValue(right, columnId), sort.direction));
};

const firstSortDirection = (columnId: ColumnId) =>
  columnId === "filed" || columnId === "severity" ? "desc" as const : "asc" as const;

export const CommentLettersPane = ({ width, height, focused }: PaneProps) => {
  const client = useMemo(() => new CommentLettersClient(), []);
  const [storedQuery] = usePaneSettingValue("query", "");
  const initialQuery = String(storedQuery ?? "").trim();
  const [query, setQuery] = usePluginPaneState("query", initialQuery);
  const [selectedId, setSelectedId] = useDebouncedPluginPaneState<string | null>("selectedId", null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortPreference<ColumnId>>({ columnId: "filed", direction: "desc" });
  const { active: searchFocused, focus: focusSearch, searchProps } = useQueryBarSearch();
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const loader = useCallback(async () => {
    const letters = await client.listCommentLetters({ query: query.trim(), count: LETTER_LIST_LIMIT });
    return letters.map(toCommentLetterRow);
  }, [client, query]);
  const { data, loading: refreshing, error, updatedAt: lastUpdated, reload: refresh } = useAsyncResource(loader);
  const letters = data ?? EMPTY_ROWS;
  const rows = useMemo(() => sortRows(letters, sort), [letters, sort]);
  const columns = useMemo(() => letterColumns(width), [width]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const openLetter = openItemId ? rows.find((row) => row.id === openItemId) ?? null : null;
  const detailLetter = openLetter ?? selected;
  // A stored open id is dropped once that letter leaves the loaded page.
  useEffect(() => {
    if (openItemId && data && !openLetter) setOpenItemId(null);
  }, [data, openItemId, openLetter]);

  const updateQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery.trim());
    setSelectedId(null);
    setOpenItemId(null);
  }, [setQuery, setSelectedId]);

  const loading = refreshing && letters.length === 0;
  const updatedAgo = useUpdatedAgo(lastUpdated);
  useAutoRefresh(lastUpdated, refresh);
  usePaneRefreshKey(() => void refresh(), { focused, enabled: !searchFocused && !openItemId });

  const detailUrl = detailLetter?.url || null;
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
    registrationId: COMMENT_LETTERS_PANE_ID,
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

  const handleHeaderClick = useCallback((columnId: string) => {
    if (!columns.some((column) => column.id === columnId)) return;
    setSort((current) => nextHeaderSort(current, columnId as ColumnId, { firstDirection: firstSortDirection }));
  }, [columns]);

  const renderCell = useCallback((row: CommentLetterRow, column: LetterColumn): DataTableCell => {
    switch (column.id) {
      case "filed":
        return { text: row.filed || "—", value: row.filedAt ? new Date(row.filedAt) : null, color: colors.textMuted };
      case "form":
        return { text: row.form, color: colors.textBright };
      case "severity":
        return {
          text: row.severityLabel,
          value: row.score,
          color: severityColor(row.severity),
          keepColorWhenSelected: true,
        };
      case "company":
        return { text: row.company, color: colors.text };
      case "topic":
        return { text: row.topic || "—", color: colors.textDim };
    }
  }, []);

  const searchBar = (
    <QueryBar
      width={width}
      search={{
        value: query,
        onChange: updateQuery,
        placeholder: "company or topic",
        focused: focused && !openItemId,
        debounceMs: SEARCH_DEBOUNCE_MS,
        normalizeValue: (value) => value.trim(),
        ...searchProps,
      }}
    />
  );

  if (loading || (error && letters.length === 0)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {searchBar}
        <PaneStatusBody loading={loading} error={error} subject="comment letters" />
      </Box>
    );
  }

  const detailWidth = Math.max(0, width - 2);
  const signals = (openLetter?.reasons ?? []).filter((reason) => !PLACEHOLDER_REASONS.has(reason));
  const detail = openLetter ? (
    <DetailScrollBody ref={detailScrollRef} resetScrollKey={openLetter.id}>
      <Box flexDirection="column">
        <KeyValueRow label="Filed" value={openLetter.filed || "—"} width={detailWidth} />
        <KeyValueRow label="Severity" value={`${openLetter.severityLabel} · ${openLetter.score}`} width={detailWidth} />
        <KeyValueRow label="CIK" value={openLetter.cik} width={detailWidth} />
        {openLetter.topic ? <Prose text={openLetter.topic} width={detailWidth} /> : null}
        {signals.length > 0 ? (
          <Section title="Signals" width={detailWidth}>
            <BulletList items={signals} width={detailWidth} />
          </Section>
        ) : null}
      </Box>
    </DetailScrollBody>
  ) : null;

  return (
    <DataTableStackView<CommentLetterRow, LetterColumn>
      focused={focused && !searchFocused}
      detailOpen={!!openLetter}
      onBack={() => setOpenItemId(null)}
      detailContent={detail}
      detailTitle={openLetter ? `${openLetter.form} · ${openLetter.company}` : undefined}
      detailScrollRef={detailScrollRef}
      rootBefore={searchBar}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      getItemKey={(row) => row.id}
      renderCell={renderCell}
      selection={{
        kind: "id",
        selectedId: selected?.id ?? null,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={(row) => setOpenItemId(row.id)}
      onRootKeyDown={handleRootKeyDown}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={handleHeaderClick}
      selectedTextOverridesCellColor
      emptyStateTitle={query.trim() ? `No comment letters match ${query.trim()}.` : "No recent comment letters."}
      emptyStateHint="Press / to search…"
    />
  );
};
