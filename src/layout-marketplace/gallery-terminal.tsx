import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../ui";
import {
  DataTableStackView,
  InputSearchBar,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type PaneFooterSegment,
  type PaneHint,
} from "../components";
import { useViewport } from "../react/input";
import { useThemeColors } from "../theme/theme-context";
import { isPlainKey } from "../utils/keyboard";
import {
  applySortPreference,
  CLEARED_SORT,
  nextSortPreference,
  type SortPreference,
} from "../utils/sort-values";
import { paneSearchHint, usePaneFooterHintBindings } from "../plugins/builtin/shared/pane-footer";
import { t, tf } from "../i18n";
import type { LayoutGalleryController } from "./gallery";
import {
  describeArrangement,
  formatPublishedAt,
  summarizeLayoutPanes,
  type GalleryEntry,
} from "./model";

type ColumnId = "name" | "arrangement" | "author" | "published";
type Column = DataTableColumn & { id: ColumnId };

function buildColumns(): Column[] {
  return [
    { id: "name", label: "LAYOUT", width: 16, align: "left", flexGrow: 1 },
    { id: "arrangement", label: "ARRANGEMENT", width: 16, align: "left" },
    { id: "author", label: "AUTHOR", width: 12, align: "left" },
    { id: "published", label: "PUBLISHED", width: 12, align: "left" },
  ];
}

const COLUMNS = buildColumns();

function sortValue(entry: GalleryEntry, columnId: ColumnId): string {
  switch (columnId) {
    case "name":
      return entry.name;
    case "arrangement":
      return describeArrangement(entry.layout);
    case "author":
      return entry.author ?? "";
    case "published":
      return entry.publishedAt ?? "";
  }
}

function renderCell(
  entry: GalleryEntry,
  column: Column,
  rowState: { selected: boolean },
  colors: ReturnType<typeof useThemeColors>,
): DataTableCell {
  const selected = rowState.selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "name":
      return {
        text: entry.name,
        color: selected ?? (entry.active ? colors.borderFocused : colors.text),
        ...(entry.active ? { attributes: TextAttributes.BOLD } : {}),
      };
    case "arrangement":
      return { text: describeArrangement(entry.layout), color: selected ?? colors.textDim };
    case "author":
      return { text: entry.author ?? "—", color: selected ?? colors.textDim };
    case "published":
      return {
        text: entry.publishedAt ? formatPublishedAt(entry.publishedAt) : "—",
        color: selected ?? colors.textDim,
      };
  }
}

export function LayoutGalleryTerminal({
  controller,
  dialogOpen,
  focused,
  width,
  height,
}: {
  controller: LayoutGalleryController;
  dialogOpen: boolean;
  focused: boolean;
  width?: number;
  height?: number;
}) {
  const colors = useThemeColors();
  const viewport = useViewport();
  const paneWidth = width ?? viewport.width;
  const paneHeight = height ?? viewport.height;
  const inputRef = useRef<InputRenderable | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [sortPreference, setSortPreference] = useState<SortPreference<ColumnId>>(CLEARED_SORT);
  const {
    activate: activateLayout,
    canDelete,
    copyLink,
    deleteLayout,
    duplicateLayout,
    install: installLayout,
    newLayout,
    publishCurrent,
    publishing,
    renameLayout,
    select,
    signedIn,
  } = controller;
  const entries = controller.entries;
  const discoverState = controller.discover.state;

  const rows = useMemo(
    () => applySortPreference(entries, sortPreference, sortValue),
    [entries, sortPreference],
  );

  const selected = useMemo(
    () => rows.find((entry) => entry.id === controller.selectedId) ?? rows[0] ?? null,
    [controller.selectedId, rows],
  );

  const topMatchId = rows[0]?.id ?? null;
  useEffect(() => {
    select(topMatchId);
  }, [controller.query, select, topMatchId]);
  useEffect(() => {
    if (selected && selected.id !== controller.selectedId) select(selected.id);
  }, [controller.selectedId, select, selected]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const blurSearch = useCallback(() => setSearchFocused(false), []);

  const activate = useCallback((entry: GalleryEntry | null) => {
    if (!entry) return;
    if (entry.kind === "community") installLayout(entry);
    else activateLayout(entry);
  }, [activateLayout, installLayout]);

  const selectedRef = useRef<GalleryEntry | null>(selected);
  selectedRef.current = selected;
  const activateSelected = useCallback(() => activate(selectedRef.current), [activate]);
  const renameSelected = useCallback(() => {
    const entry = selectedRef.current;
    if (entry?.kind === "owned") renameLayout(entry);
  }, [renameLayout]);
  const copySelected = useCallback(() => {
    const entry = selectedRef.current;
    if (entry?.kind === "community") copyLink(entry);
    else if (entry?.kind === "owned") duplicateLayout(entry);
  }, [copyLink, duplicateLayout]);
  const deleteSelected = useCallback(() => {
    const entry = selectedRef.current;
    if (entry?.kind === "owned") deleteLayout(entry);
  }, [deleteLayout]);

  const info: PaneFooterSegment[] = [];
  if (discoverState.status === "error") {
    info.push({
      id: "error",
      onPress: controller.discover.refresh,
      parts: [{ text: discoverState.error, tone: "warning" }],
    });
  }

  const hints: PaneHint[] = [
    paneSearchHint(focusSearch),
    { id: "new", key: "n", label: "ew", onPress: newLayout },
    ...(selected?.kind === "owned"
      ? [
          { id: "open", key: "o", label: "pen", onPress: activateSelected },
          { id: "rename", key: "r", label: "ename", onPress: renameSelected },
          { id: "copy", key: "c", label: "opy", onPress: copySelected },
          { id: "delete", key: "d", label: "elete", onPress: deleteSelected, disabled: !canDelete },
        ]
      : selected?.kind === "community"
        ? [
            { id: "add", key: "a", label: "dd layout", onPress: activateSelected },
            { id: "copy-link", key: "c", label: "opy link", onPress: copySelected },
          ]
        : []),
    ...(!signedIn
      ? [{ id: "login", key: "l", label: "og in", onPress: controller.requestSignIn }]
      : discoverState.status === "error" && selected?.kind !== "owned"
        ? [{ id: "retry", key: "r", label: "etry", onPress: controller.discover.refresh }]
        : []),
    { id: "publish", key: "p", label: "ublish", onPress: publishCurrent, disabled: publishing },
  ];

  usePaneFooterHintBindings(focused && !searchFocused && !dialogOpen, hints);
  usePaneFooter("layout-marketplace", () => ({
    info,
    trailingInfo: [
      ...(publishing ? [{ id: "publishing", parts: [{ text: "publishing", tone: "muted" as const }] }] : []),
      ...(!signedIn ? [{ id: "auth", parts: [{ text: "sign in to browse", tone: "muted" as const }] }] : []),
      ...(signedIn && (discoverState.status === "idle" || discoverState.status === "loading")
        ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }]
        : []),
    ],
    hints,
  }), [
    discoverState.status,
    hints,
    info,
    publishing,
    signedIn,
  ]);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (searchFocused || dialogOpen) return;
    const cursor = selectedRef.current;
    if (isPlainKey(event, "up") && cursor && rows[0]?.id === cursor.id) {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    return undefined;
  }, [dialogOpen, focusSearch, rows, searchFocused]);

  const detail = controller.detail;

  return (
    <Box flexGrow={1} flexDirection="column" backgroundColor={colors.bg}>
      <DataTableStackView<GalleryEntry, Column>
        focused={focused && !searchFocused && !dialogOpen}
        detailOpen={!!detail}
        onBack={controller.closeDetail}
        detailContent={detail ? (
          <LayoutDetails
            controller={controller}
            entry={detail}
            width={paneWidth}
          />
        ) : null}
        detailTitle={detail?.name}
        rootBefore={(
          <InputSearchBar
            value={controller.query}
            focused={focused && !dialogOpen && !detail}
            active={searchFocused}
            width={paneWidth}
            focusToken={searchFocusToken}
            inputRef={inputRef}
            placeholder={t("Search layouts and panes")}
            debounceMs={80}
            onFocus={focusSearch}
            onBlur={blurSearch}
            onNavigateDown={blurSearch}
            onQueryChange={controller.setQuery}
          />
        )}
        selection={{
          kind: "id",
          selectedId: selected?.id ?? null,
          getId: (entry) => entry.id,
          onChange: (id) => select(typeof id === "string" ? id : null),
        }}
        onCursorChange={(entry) => select(entry.id)}
        onRootKeyDown={handleRootKeyDown}
        onDetailKeyDown={(event) => {
          if (isPlainKey(event, "enter", "return")) {
            event.preventDefault?.();
            event.stopPropagation?.();
            activateSelected();
            return true;
          }
          return handleRootKeyDown(event);
        }}
        onActivate={(entry) => controller.openDetail(entry)}
        rootWidth={paneWidth}
        rootHeight={paneHeight}
        columns={COLUMNS}
        items={rows}
        getItemKey={(entry) => entry.id}
        sortColumnId={sortPreference.columnId}
        sortDirection={sortPreference.direction}
        onHeaderClick={(columnId) => {
          setSortPreference((current) => nextSortPreference(current, columnId as ColumnId, {
            defaultDirection: (id) => (id === "published" ? "desc" : "asc"),
            resetTo: CLEARED_SORT,
          }));
        }}
        renderCell={(entry, column, _index, rowState) => renderCell(entry, column, rowState, colors)}
        emptyStateTitle={discoverState.status === "error" && rows.length === 0
          ? t("Community layouts unavailable.")
          : controller.query.trim()
            ? t("No layouts match this search.")
            : t("No layouts yet.")}
        emptyStateHint={discoverState.status === "error" && rows.length === 0
          ? `${discoverState.error} Press r to retry.`
          : undefined}
      />
    </Box>
  );
}

function LayoutDetails({
  controller,
  entry,
  width,
}: {
  controller: LayoutGalleryController;
  entry: GalleryEntry;
  width: number;
}) {
  const colors = useThemeColors();
  const allPanes = summarizeLayoutPanes(entry.layout, controller.panes);
  const missing = allPanes.filter((pane) => pane.missing);

  return (
    <ScrollBox flexDirection="column" width={width} paddingLeft={1} paddingRight={1}>
      {entry.author && (
        <Text fg={colors.textMuted}>
          {entry.publishedAt
            ? `${entry.author} · ${formatPublishedAt(entry.publishedAt)}`
            : entry.author}
        </Text>
      )}
      <Text fg={colors.textDim}>{describeArrangement(entry.layout)}</Text>
      <Box height={1} />
      {allPanes.map((pane) => {
        const trailing = pane.missing ? t("unavailable") : pane.paneId;
        const label = pane.symbol ? `${pane.name} · ${pane.symbol}` : pane.name;
        return (
          <Box key={pane.instanceId} minWidth={0} flexDirection="row" justifyContent="space-between" gap={1}>
            <Text
              fg={pane.missing ? colors.textMuted : colors.text}
              wrapText
              style={{ minWidth: 0, flexShrink: 1 }}
            >
              {label}
            </Text>
            <Text
              fg={colors.textMuted}
              wrapText
              style={{ minWidth: 0, flexShrink: 1 }}
            >
              {trailing}
            </Text>
          </Box>
        );
      })}
      {missing.length > 0 && (
        <>
          <Box height={1} />
          <Text fg={colors.warning}>
            {missing.length === 1
              ? t("1 pane type is not installed here.")
              : tf("{count} pane types are not installed here.", { count: String(missing.length) })}
          </Text>
        </>
      )}
    </ScrollBox>
  );
}
