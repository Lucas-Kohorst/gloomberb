import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { TextFieldDialog } from "../../../components/pane-settings-dialog/field-dialogs";
import { colors } from "../../../theme/colors";
import { Box, TextAttributes } from "../../../ui";
import { useDialog, type AlertContext } from "../../../ui/dialog";
import type { PaneProps } from "../../../types/plugin";
import { usePluginAppActions, usePluginConfigState } from "../../runtime";
import {
  deserializeAlerts,
  editAlert,
  isAlertSnoozed,
  rearmAlert as rebuildAlert,
  readAlertsStoreError,
  serializeAlerts,
  snoozeAlert,
} from "./alert-engine";
import { parseAlertCommandValues } from "./command";
import { ALERTS_KEY, SNOOZE_DURATION_MS } from "./constants";
import { AlertHistoryPane } from "./history-pane";
import {
  conditionLabel,
  formatAlertDistance,
  formatAlertTargetPrice,
  formatCurrentPrice,
  formatQuoteChecked,
  formatSnoozeRemaining,
  relativeTime,
} from "./format";
import type { AlertRule } from "./types";
import { isPriceAlertCondition } from "./types";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";

type AlertColumnId =
  | "status"
  | "symbol"
  | "current"
  | "target"
  | "away"
  | "condition"
  | "quote"
  | "triggered"
  | "rearm";

type AlertColumn = DataTableColumn & { id: AlertColumnId };

const ALERT_COLUMNS: AlertColumn[] = [
  // Wide enough for the snooze countdown, e.g. "Snooz 12m".
  { id: "status", label: "State", width: 9, align: "left" },
  { id: "symbol", label: "Symbol", width: 7, align: "left" },
  { id: "current", label: "Current", width: 9, align: "right" },
  { id: "target", label: "Target", width: 9, align: "right" },
  { id: "away", label: "Away%", width: 8, align: "right" },
  { id: "condition", label: "Trigger", width: 7, align: "left" },
  { id: "quote", label: "Quote", width: 8, align: "left" },
  { id: "triggered", label: "Alerted", width: 8, align: "left" },
  { id: "rearm", label: "", width: 6, align: "left" },
];

const ALERT_TABLE_CONTENT_WIDTH = ALERT_COLUMNS.reduce(
  (sum, column) => sum + column.width + 1,
  2,
);

function AlertRulesPane({ focused, width, height, close }: PaneProps) {
  const [alertsJson, setAlertsJson] = usePluginConfigState<string>(ALERTS_KEY, "[]");
  const { openPluginCommandWorkflow } = usePluginAppActions();
  const dialog = useDialog();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortPreference, setSortPreference] = useState<SortPreference<AlertColumnId>>({
    columnId: null,
    direction: "asc",
  });
  const showHorizontalScrollbar = ALERT_TABLE_CONTENT_WIDTH > width;
  const storeError = useMemo(() => readAlertsStoreError(alertsJson), [alertsJson]);

  const { alerts, rows, quoteError } = useMemo(() => {
    const parsed = deserializeAlerts(alertsJson);
    const activeAlerts = parsed.filter((a) => a.status === "active");
    const triggeredAlerts = parsed
      .filter((a) => a.status === "triggered")
      .sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));

    return {
      alerts: parsed,
      rows: [...activeAlerts, ...triggeredAlerts],
      quoteError: parsed.find((alert) => alert.lastCheckError)?.lastCheckError ?? null,
    };
  }, [alertsJson]);

  const sortedRows = useMemo(
    () => applySortPreference(rows, sortPreference, (alert, columnId) => {
      switch (columnId) {
        case "status": return alert.status;
        case "symbol": return alert.symbol;
        case "current": return alert.lastCheckedPrice ?? null;
        case "target": return isPriceAlertCondition(alert.condition) ? alert.targetPrice : null;
        case "away": {
          if (!isPriceAlertCondition(alert.condition) || alert.lastCheckError) return null;
          const currentPrice = alert.lastCheckedPrice;
          if (currentPrice == null || currentPrice === 0) return null;
          const percent = ((alert.targetPrice - currentPrice) / currentPrice) * 100;
          return Number.isFinite(percent) ? percent : null;
        }
        case "condition": return conditionLabel(alert.condition);
        case "quote": return alert.lastQuoteUpdatedAt ?? alert.lastCheckedAt ?? null;
        case "triggered": return alert.triggeredAt ?? null;
        case "rearm": return alert.status === "triggered" ? 2 : isAlertSnoozed(alert) ? 1 : 0;
      }
    }),
    [rows, sortPreference],
  );

  const savePaneAlerts = useCallback((next: AlertRule[] | ((current: AlertRule[]) => AlertRule[])) => {
    setAlertsJson((currentJson) => {
      const current = deserializeAlerts(currentJson);
      const resolved = typeof next === "function" ? next(current) : next;
      return serializeAlerts(resolved);
    });
  }, [setAlertsJson]);

  const deleteAlert = useCallback((id: string) => {
    savePaneAlerts(alerts.filter((a) => a.id !== id));
    setSelectedIdx((prev) => Math.max(0, Math.min(prev, rows.length - 2)));
  }, [alerts, rows.length, savePaneAlerts]);

  const rearmAlert = useCallback((id: string) => {
    savePaneAlerts(
      alerts.map((a) => (a.id === id ? rebuildAlert(a) : a)),
    );
  }, [alerts, savePaneAlerts]);

  const snoozeAlertById = useCallback((id: string) => {
    savePaneAlerts(alerts.map((a) => (a.id === id ? snoozeAlert(a, SNOOZE_DURATION_MS) : a)));
  }, [alerts, savePaneAlerts]);

  const wakeAlert = useCallback((id: string) => {
    savePaneAlerts(alerts.map((a) => (a.id === id ? { ...a, snoozedUntil: undefined } : a)));
  }, [alerts, savePaneAlerts]);

  const startAddAlert = useCallback(() => {
    openPluginCommandWorkflow("set-alert");
  }, [openPluginCommandWorkflow]);
  const startAddWeatherAlert = useCallback(() => {
    openPluginCommandWorkflow("set-weather-alert");
  }, [openPluginCommandWorkflow]);

  const deleteSelectedAlert = useCallback(() => {
    const selected = rows[selectedIdx];
    if (selected) deleteAlert(selected.id);
  }, [deleteAlert, rows, selectedIdx]);

  const snoozeSelectedAlert = useCallback(() => {
    const selected = sortedRows[selectedIdx];
    if (!selected) return;
    snoozeAlertById(selected.id);
  }, [sortedRows, snoozeAlertById, selectedIdx]);

  const editSelectedAlert = useCallback(() => {
    const selected = rows[selectedIdx];
    if (!selected) return;
    void dialog.alert({
      closeOnClickOutside: true,
      content: (context: AlertContext) => (
        <TextFieldDialog
          {...context}
          field={{
            type: "text",
            key: "alert",
            label: "Edit alert",
            description: "SYMBOL above|below|crosses PRICE, day PCT, volume MULTIPLE, or news KEYWORD",
            placeholder: "AAPL above 200",
          }}
          currentValue={selected.condition === "news_mention"
            ? `${selected.symbol} news ${selected.targetText ?? ""}`
            : `${selected.symbol} ${selected.condition} ${selected.targetPrice}`}
          onApply={async (value) => {
            const parsed = parseAlertCommandValues({ shortcut: value });
            if (!parsed) throw new Error("Use SYMBOL above|below|crosses PRICE.");
            savePaneAlerts((current) => current.map((alert) => (
              alert.id === selected.id
                ? {
                    ...editAlert(alert, parsed.symbol, parsed.condition, parsed.price),
                    ...(parsed.targetText ? { targetText: parsed.targetText } : {}),
                  }
                : alert
            )));
          }}
        />
      ),
    });
  }, [dialog, rows, savePaneAlerts, selectedIdx]);

  // Quotes come from the plugin's single background poll, which writes into the
  // same persisted store, so the pane never fetches on its own.

  usePaneFooter("alerts", () => ({
    info: storeError
      ? [{ id: "store-error", parts: [{ text: storeError, tone: "warning" as const }] }]
      : quoteError
        ? [{ id: "quote-error", parts: [{ text: quoteError, tone: "warning" as const }] }]
        : [],
    hints: [
      { id: "add", key: "a", label: "dd alert", onPress: startAddAlert },
      { id: "weather", key: "w", label: "eather", onPress: startAddWeatherAlert },
      {
        id: "edit",
        key: "e",
        label: "dit",
        onPress: editSelectedAlert,
        disabled: rows.length === 0,
      },
      {
        id: "snooze",
        key: "s",
        label: "nooze",
        onPress: snoozeSelectedAlert,
        disabled: rows.length === 0,
      },
      {
        id: "delete",
        key: "d",
        label: "elete",
        onPress: deleteSelectedAlert,
        disabled: rows.length === 0,
      },
    ],
  }), [
    deleteSelectedAlert,
    editSelectedAlert,
    quoteError,
    rows.length,
    snoozeSelectedAlert,
    startAddAlert,
    storeError,
  ]);

  useEffect(() => {
    setSelectedIdx((prev) => (rows.length === 0 ? 0 : Math.min(prev, rows.length - 1)));
  }, [rows.length]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "d") {
      event.preventDefault?.();
      deleteSelectedAlert();
      return true;
    }
    if (event.name === "a" || event.name === "n") {
      event.preventDefault?.();
      startAddAlert();
      return true;
    }
    if (event.name === "w") {
      event.preventDefault?.();
      startAddWeatherAlert();
      return true;
    }
    if (event.name === "e") {
      event.preventDefault?.();
      editSelectedAlert();
      return true;
    }
    if (event.name === "s") {
      event.preventDefault?.();
      snoozeSelectedAlert();
      return true;
    }
    if (event.name === "escape") {
      event.preventDefault?.();
      close?.();
      return true;
    }
    return false;
  }, [close, deleteSelectedAlert, editSelectedAlert, snoozeSelectedAlert, startAddAlert, startAddWeatherAlert]);

  const renderCell = useCallback((
    alert: AlertRule,
    column: AlertColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    const actionMouseDown = (handler: () => void) => (
      event: { preventDefault?: () => void; stopPropagation?: () => void },
    ) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      handler();
    };

    switch (column.id) {
      case "status": {
        const snooze = formatSnoozeRemaining(alert);
        if (snooze) return { text: snooze, color: selectedColor ?? colors.warning };
        return {
          text: alert.status === "triggered" ? "Trig" : "Active",
          color: selectedColor ?? (alert.status === "triggered" ? colors.positive : colors.textDim),
          attributes: alert.status === "triggered" ? TextAttributes.BOLD : TextAttributes.NONE,
        };
      }
      case "symbol":
        return {
          text: alert.symbol,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "current":
        return {
          text: formatCurrentPrice(alert, column.width),
          color: selectedColor ?? (alert.lastCheckError ? colors.negative : colors.text),
        };
      case "target":
        return { text: formatAlertTargetPrice(alert, column.width), color: selectedColor };
      case "away":
        return {
          text: formatAlertDistance(alert),
          color: selectedColor ?? colors.textDim,
        };
      case "condition":
        return {
          text: conditionLabel(alert.condition),
          color: selectedColor,
        };
      case "quote":
        return {
          text: formatQuoteChecked(alert),
          color: selectedColor ?? colors.textDim,
        };
      case "triggered":
        return {
          text: alert.triggeredAt ? relativeTime(alert.triggeredAt) : "-",
          color: selectedColor ?? colors.textDim,
        };
      case "rearm":
        if (isAlertSnoozed(alert)) {
          return {
            text: "Wake",
            color: selectedColor ?? colors.textBright,
            onMouseDown: actionMouseDown(() => wakeAlert(alert.id)),
          };
        }
        return alert.status === "triggered"
          ? {
              text: "Re-arm",
              color: selectedColor ?? colors.textBright,
              onMouseDown: actionMouseDown(() => rearmAlert(alert.id)),
            }
          : { text: "-", color: selectedColor ?? colors.textDim };
    }
  }, [rearmAlert, wakeAlert]);

  return (
    <DataTableView<AlertRule, AlertColumn>
      focused={focused}
      selection={{
        kind: "index",
        selectedIndex: sortedRows.length > 0 ? Math.min(selectedIdx, sortedRows.length - 1) : -1,
        onChange: (index) => setSelectedIdx(index),
      }}
      onRootKeyDown={handleTableKeyDown}
      rootWidth={width}
      rootHeight={height}
      rootBackgroundColor={colors.bg}
      columns={ALERT_COLUMNS}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId as AlertColumnId,
        {
          defaultDirection: columnId === "symbol" || columnId === "status" || columnId === "condition"
            ? "asc"
            : "desc",
        },
      ))}
      getItemKey={(alert) => alert.id}
      getRowRevision={(alert) => [
        alert.id,
        alert.status,
        alert.snoozedUntil ?? "",
        alert.lastCheckedPrice ?? "",
        alert.lastCheckError ?? "",
        alert.triggeredAt ?? "",
        alert.lastCheckedAt ?? "",
      ].join(":")}
      onActivate={(alert) => {
        if (isAlertSnoozed(alert)) wakeAlert(alert.id);
        else if (alert.status === "triggered") rearmAlert(alert.id);
      }}
      renderCell={renderCell}
      emptyStateTitle={storeError ? "Saved alerts could not be read." : "No alerts"}
      emptyStateHint={storeError ?? "Press a to add a price alert."}
      showHorizontalScrollbar={showHorizontalScrollbar}
    />
  );
}

export function AlertsPane(props: PaneProps) {
  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");
  const contentHeight = Math.max(1, props.height - 1);

  return (
    <Box flexDirection="column" width={props.width} height={props.height}>
      <Tabs
        tabs={[
          { label: "Alerts", value: "rules" },
          { label: "History", value: "history" },
        ]}
        activeValue={activeTab}
        onSelect={(value) => setActiveTab(value as "rules" | "history")}
        focused={props.focused}
      />
      {activeTab === "rules" ? (
        <AlertRulesPane {...props} height={contentHeight} />
      ) : (
        <AlertHistoryPane focused={props.focused} width={props.width} height={contentHeight} close={props.close} />
      )}
    </Box>
  );
}
