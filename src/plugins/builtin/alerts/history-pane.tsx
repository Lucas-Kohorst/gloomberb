import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConfirmDialog,
  DataTableView,
  InputSearchBar,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { formatMarketPrice } from "../../../market-data/market/format";
import { colors } from "../../../theme/colors";
import { TextAttributes, type InputRenderable } from "../../../ui";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { t } from "../../../i18n";
import { usePluginConfigState, usePluginTickerActions } from "../../runtime";
import { ALERT_HISTORY_KEY } from "./constants";
import {
  deserializeAlertHistory,
  serializeAlertHistory,
  type AlertHistoryEntry,
} from "./history";
import { relativeTime } from "./format";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";

type HistoryColumnId = "symbol" | "condition" | "price" | "triggeredAt";
type HistoryColumn = DataTableColumn & { id: HistoryColumnId };

const HISTORY_COLUMNS: HistoryColumn[] = [
  { id: "symbol", label: t("Symbol"), width: 8, align: "left" },
  { id: "condition", label: t("Trigger"), width: 32, align: "left" },
  { id: "price", label: t("Price"), width: 10, align: "right" },
  { id: "triggeredAt", label: t("Alerted"), width: 10, align: "left" },
];

export function AlertHistoryPane({
  focused,
  width,
  height,
  close,
}: {
  focused: boolean;
  width: number;
  height: number;
  close?: () => void;
}) {
  const [historyJson, setHistoryJson] = usePluginConfigState<string>(ALERT_HISTORY_KEY, "[]");
  const { navigateTicker } = usePluginTickerActions();
  const dialog = useDialog();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const [sortPreference, setSortPreference] = useState<SortPreference<HistoryColumnId>>({
    columnId: "triggeredAt",
    direction: "desc",
  });

  const entries = useMemo(() => deserializeAlertHistory(historyJson), [historyJson]);
  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? entries.filter((entry) => `${entry.symbol} ${entry.condition}`.toLowerCase().includes(query))
      : entries;
    return applySortPreference(filtered, sortPreference, (entry, columnId) => {
      switch (columnId) {
        case "symbol": return entry.symbol;
        case "condition": return entry.condition;
        case "price": return entry.price ?? null;
        case "triggeredAt": return entry.triggeredAt;
      }
    });
  }, [entries, searchQuery, sortPreference]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((current) => current + 1);
  }, []);
  const openSelected = useCallback(() => {
    const entry = rows[selectedIdx];
    if (entry) navigateTicker(entry.symbol);
  }, [navigateTicker, rows, selectedIdx]);
  const clearHistory = useCallback(async () => {
    if (entries.length === 0) return;
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: unknown) => (
        <ConfirmDialog
          {...(context as PromptContext<boolean>)}
          title={t("Clear alert history")}
          body={t("Clear all alert history? This cannot be undone.")}
          confirmLabel={t("Clear history")}
          cancelLabel={t("Cancel")}
        />
      ),
    }).catch(() => false);
    if (confirmed === true) setHistoryJson(serializeAlertHistory([]));
  }, [dialog, entries.length, setHistoryJson]);

  usePaneFooter("alerts", () => ({
    info: [],
    hints: [
      { id: "search", key: "/", label: t("search"), onPress: focusSearch },
      { id: "open", key: "o", label: t("pen"), onPress: openSelected, disabled: !rows[selectedIdx] },
      { id: "clear", key: "c", label: t("lear"), onPress: () => void clearHistory(), disabled: entries.length === 0 },
    ],
  }), [clearHistory, entries.length, focusSearch, openSelected, rows, selectedIdx]);

  useEffect(() => {
    setSelectedIdx((current) => rows.length === 0 ? 0 : Math.min(current, rows.length - 1));
  }, [rows.length]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return true;
    }
    if (event.name === "o") {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
      return true;
    }
    if (event.name === "c") {
      event.preventDefault?.();
      event.stopPropagation?.();
      void clearHistory();
      return true;
    }
    if (event.name === "escape") {
      event.preventDefault?.();
      close?.();
      return true;
    }
    return false;
  }, [clearHistory, close, focusSearch, openSelected]);

  const renderCell = useCallback((
    entry: AlertHistoryEntry,
    column: HistoryColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "symbol":
        return {
          text: entry.symbol,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "condition":
        return { text: entry.condition, color: selectedColor ?? colors.text };
      case "price":
        return {
          text: entry.price == null ? "-" : formatMarketPrice(entry.price, { maxWidth: column.width, minimumFractionDigits: 2 }),
          color: selectedColor ?? colors.text,
        };
      case "triggeredAt":
        return { text: relativeTime(entry.triggeredAt), color: selectedColor ?? colors.textDim };
    }
  }, []);

  return (
    <DataTableView<AlertHistoryEntry, HistoryColumn>
      focused={focused && !searchFocused}
      selection={{
        kind: "index",
        selectedIndex: rows.length > 0 ? Math.min(selectedIdx, rows.length - 1) : -1,
        onChange: (index) => setSelectedIdx(index),
      }}
      onActivate={openSelected}
      onRootKeyDown={handleTableKeyDown}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.bg}
      rootBefore={<InputSearchBar value={searchQuery} focused={focused} active={searchFocused} width={width} focusToken={searchFocusToken} inputRef={searchInputRef} placeholder={t("symbol or trigger")} debounceMs={80} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={setSearchQuery} />}
      columns={HISTORY_COLUMNS}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as HistoryColumnId,
        { defaultDirection: columnId === "symbol" || columnId === "condition" ? "asc" : "desc" },
      ))}
      getItemKey={(entry) => `${entry.id}:${entry.triggeredAt}`}
      getRowRevision={(entry) => `${entry.id}:${entry.triggeredAt}:${entry.price ?? ""}`}
      renderCell={renderCell}
      emptyStateTitle={searchQuery.trim() ? t("No matching alerts.") : t("No alert history")}
      emptyStateHint={searchQuery.trim() ? t("Clear search.") : t("Triggered alerts will appear here.")}
    />
  );
}
