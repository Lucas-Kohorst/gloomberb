import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConfirmDialog,
  DataTableView,
  InputSearchBar,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { t } from "../../../i18n";
import { useDialog, type PromptContext } from "../../../ui/dialog";
import { usePluginAppActions } from "../../runtime";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import {
  clearNotificationLog,
  configureNotificationLog,
  getNotificationLog,
  markNotificationLogRead,
  subscribeNotificationLog,
  type NotificationLogEntry,
} from "../../../notifications/notification-log";
import { nextSortPreference, applySortPreference, type SortPreference } from "../../../utils/sort-values";
import { usePaneFooterHintBindings } from "../shared/pane-footer";

const NOTIFICATION_LOG_KEY = "notification-log";

type NotificationColumnId = "state" | "date" | "source" | "notification";
type NotificationColumn = DataTableColumn & { id: NotificationColumnId };
type NotificationRow = NotificationLogEntry | { id: string; group: string };

const COLUMNS: NotificationColumn[] = [
  { id: "state", label: t("State"), width: 6, align: "left" },
  { id: "date", label: t("Date"), width: 12, align: "left" },
  { id: "source", label: t("Source"), width: 14, align: "left" },
  { id: "notification", label: t("Notification"), flexGrow: 1, width: 24, align: "left" },
];

function formatDate(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t("Today");
  if (date.toDateString() === yesterday.toDateString()) return t("Yesterday");
  return date.toLocaleDateString();
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sourceDestination(source: string): "alerts" | "chat" | null {
  if (source === "alerts") return "alerts";
  if (source === "gloomberb-cloud" || source === "chat") return "chat";
  return null;
}

function notificationSortValue(entry: NotificationLogEntry, column: NotificationColumnId): string | number {
  if (column === "state") return entry.read ? 1 : 0;
  if (column === "date") return entry.at;
  if (column === "source") return entry.source;
  return `${entry.title ?? ""} ${entry.body}`;
}

function NotificationCenterPane({ focused, width, height }: PaneProps) {
  const dialog = useDialog();
  const { showPane } = usePluginAppActions();
  const [entries, setEntries] = useState<readonly NotificationLogEntry[]>(getNotificationLog);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchInputRef = useRef<import("../../../ui").InputRenderable | null>(null);
  const [sort, setSort] = useState<SortPreference<NotificationColumnId>>({
    columnId: "date",
    direction: "desc",
  });

  useEffect(() => subscribeNotificationLog(() => setEntries(getNotificationLog())), []);
  useEffect(() => {
    markNotificationLogRead();
  }, [entries]);

  const rows = useMemo<NotificationRow[]>(() => {
    const lowerQuery = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => !lowerQuery || [
      entry.title,
      entry.body,
      entry.source,
      formatDate(entry.at),
    ].filter(Boolean).join(" ").toLowerCase().includes(lowerQuery));
    const days = new Map<string, NotificationLogEntry[]>();
    for (const entry of filtered) {
      const group = formatDate(entry.at);
      const groupEntries = days.get(group) ?? [];
      groupEntries.push(entry);
      days.set(group, groupEntries);
    }
    const orderedDays = [...days.entries()].sort(([, left], [, right]) => {
      const leftAt = Math.max(...left.map((entry) => entry.at));
      const rightAt = Math.max(...right.map((entry) => entry.at));
      return sort.columnId === "date" && sort.direction === "asc" ? leftAt - rightAt : rightAt - leftAt;
    });
    return orderedDays.flatMap(([group, groupEntries]) => [
      { id: `group-${group}`, group },
      ...applySortPreference(groupEntries, sort, notificationSortValue),
    ]);
  }, [entries, query, sort]);

  const selectedRow = rows[Math.min(selectedIndex, Math.max(0, rows.length - 1))] ?? null;
  const selected = selectedRow && "body" in selectedRow ? selectedRow : null;
  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((value) => value + 1);
  }, []);
  const openSelected = useCallback(() => {
    const destination = selected && sourceDestination(selected.source);
    if (destination) showPane?.(destination);
  }, [selected, showPane]);
  const markAllRead = useCallback(() => markNotificationLogRead(), []);
  const requestClear = useCallback(async () => {
    const confirmed = await dialog.prompt<boolean>({
      closeOnClickOutside: true,
      content: (context: PromptContext<boolean>) => (
        <ConfirmDialog
          {...context}
          title={t("Clear notification history?")}
          body={[t("This cannot be undone.")]}
          confirmLabel={t("Clear")}
          cancelLabel={t("Cancel")}
          width={44}
        />
      ),
    }).catch(() => false);
    if (confirmed) clearNotificationLog();
  }, [dialog]);

  const footerHints = useMemo(() => [
    { id: "search", key: "/", label: t("search"), onPress: focusSearch },
    ...(selected && sourceDestination(selected.source)
      ? [{ id: "open", key: "o", label: t("pen"), onPress: openSelected }]
      : []),
    { id: "mark-all-read", key: "m", label: t("ark all read"), onPress: markAllRead },
    { id: "clear", key: "c", label: t("lear"), onPress: () => { void requestClear(); } },
  ], [focusSearch, markAllRead, openSelected, requestClear, selected]);
  usePaneFooterHintBindings(focused && !searchFocused, footerHints);
  usePaneFooter("notification-center", () => ({ hints: footerHints }), [footerHints]);

  const renderCell = useCallback((
    entry: NotificationRow,
    column: NotificationColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    if ("group" in entry) {
      return column.id === "notification"
        ? { text: entry.group, color: selectedColor ?? colors.textBright }
        : { text: "" };
    }
    if (column.id === "state") {
      return { text: entry.read ? t("Read") : t("New"), color: selectedColor ?? (entry.read ? colors.textDim : colors.textBright) };
    }
    if (column.id === "date") return { text: `${formatDate(entry.at)} ${formatTime(entry.at)}`, color: selectedColor ?? colors.textDim };
    if (column.id === "source") return { text: entry.source, color: selectedColor ?? colors.textDim };
    return { text: entry.title ? `${entry.title}: ${entry.body}` : entry.body, color: selectedColor ?? colors.text };
  }, []);

  return (
    <DataTableView<NotificationRow, NotificationColumn>
      focused={focused && !searchFocused}
      selection={{ kind: "index", selectedIndex: rows.length ? Math.min(selectedIndex, rows.length - 1) : -1, onChange: setSelectedIndex }}
      onActivate={() => openSelected()}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.bg}
      rootBefore={<InputSearchBar value={query} focused={focused} active={searchFocused} width={width} focusToken={searchFocusToken} inputRef={searchInputRef} placeholder={t("Search notifications")} debounceMs={80} onFocus={focusSearch} onBlur={() => setSearchFocused(false)} onNavigateDown={() => setSearchFocused(false)} onQueryChange={setQuery} />}
      columns={COLUMNS}
      items={rows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as NotificationColumnId, { defaultDirection: columnId === "date" ? "desc" : "asc" }))}
      getItemKey={(entry) => entry.id}
      renderCell={renderCell}
      emptyStateTitle={t("No notifications.")}
      emptyStateHint={t("Notifications from alerts and chat will appear here.")}
    />
  );
}

export const notificationCenterPlugin: GloomPlugin = {
  id: "notification-center",
  name: "Notification Center",
  version: "1.0.0",
  description: "Review alert, chat, and app notification history",
  toggleable: true,
  setup(ctx) {
    configureNotificationLog({
      get: () => {
        const value = ctx.configState.get<unknown>(NOTIFICATION_LOG_KEY);
        return Array.isArray(value) ? value : [];
      },
      set: (entries) => ctx.configState.set(NOTIFICATION_LOG_KEY, entries),
    });
    ctx.registerPane({
      id: "notification-center",
      name: "Notifications",
      component: NotificationCenterPane,
      defaultPosition: "right",
    });
    ctx.registerPaneTemplate({
      id: "notification-center-pane",
      paneId: "notification-center",
      label: "Notification Center",
      description: "Review alert, chat, and app notification history",
      keywords: ["notifications", "alerts", "mentions", "history"],
      shortcut: { prefix: "NOTF" },
    });
    ctx.registerAgentPromptFragment("Notification Center: pane.createFromTemplate notification-center-pane (NOTF) to review alert, chat, and app notification history.");
  },
  dispose() {
    configureNotificationLog(null);
  },
};

export default notificationCenterPlugin;
