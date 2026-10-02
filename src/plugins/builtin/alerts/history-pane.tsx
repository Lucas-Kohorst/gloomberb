import { useCallback, useMemo, useState } from "react";
import {
  ConfirmDialog,
  DataTableView,
  PaneListChrome,
  usePaneFooter,
  usePaneListSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { formatMarketPrice } from "../../../market-data/market/format";
import { colors } from "../../../theme/colors";
import { TextAttributes } from "../../../ui";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  const { search, searchFocused, focusSearch, handleSearchKey } = usePaneListSearch({
    focused,
    value: searchQuery,
    onQueryChange: (value) => {
      setSearchQuery(value);
      setSelectedKey(null);
    },
    placeholder: t("symbol or trigger"),
    debounceMs: 80,
  });
  const rowKey = useCallback((entry: AlertHistoryEntry) => `${entry.id}:${entry.triggeredAt}`, []);
  const selected = rows.find((entry) => rowKey(entry) === selectedKey) ?? rows[0] ?? null;
  const openSelected = useCallback(() => {
    if (selected) navigateTicker(selected.symbol);
  }, [navigateTicker, selected]);
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
      { id: "open", key: "o", label: t("pen"), onPress: openSelected, disabled: !selected },
      { id: "clear", key: "c", label: t("lear"), onPress: () => void clearHistory(), disabled: entries.length === 0 },
    ],
  }), [clearHistory, entries.length, focusSearch, openSelected, selected]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (handleSearchKey(event)) return true;
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
  }, [clearHistory, close, handleSearchKey, openSelected]);

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
        kind: "id",
        selectedId: selected ? rowKey(selected) : null,
        getId: rowKey,
        onChange: setSelectedKey,
      }}
      onActivate={(entry) => navigateTicker(entry.symbol)}
      onRootKeyDown={handleTableKeyDown}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.bg}
      rootBefore={<PaneListChrome width={width} focused={focused && !searchFocused} search={search} />}
      columns={HISTORY_COLUMNS}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as HistoryColumnId,
        { defaultDirection: columnId === "symbol" || columnId === "condition" ? "asc" : "desc" },
      ))}
      getItemKey={rowKey}
      getRowRevision={(entry) => `${entry.id}:${entry.triggeredAt}:${entry.price ?? ""}`}
      renderCell={renderCell}
      emptyStateTitle={searchQuery.trim() ? t("No matching alerts.") : t("No alert history")}
      emptyStateHint={searchQuery.trim() ? t("Clear search.") : t("Triggered alerts will appear here.")}
    />
  );
}
