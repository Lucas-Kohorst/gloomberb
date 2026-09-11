import { useCallback, useMemo, useState } from "react";
import {
  DataTableView,
  Spinner,
  nextStackSortPreference,
  sortStackItems,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type PaneFooterSegment,
  type StackSortPreference,
} from "../../../components";
import { Box } from "../../../ui";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { useFxRatesMap } from "../../../market-data/hooks";
import { usePaneSettingValue } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { TextAttributes } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { useAssetData } from "../../runtime";
import type { PluginModule } from "../plugin-module";
import { useAutoRefresh, useUpdatedAgo } from "../shared/auto-refresh";
import { MAJOR_CURRENCIES, formatRate, resolveCurrencies, type MajorCurrency } from "./pairs";

const FX_MATRIX_PANE_ID = "fx-matrix";
/** Stable identity: a fresh literal here would reload the board every render. */
const NO_SAVED_CURRENCIES: string[] = [];
const BASE_COLUMN_WIDTH = 5;
const RATE_COLUMN_WIDTH = 10;

interface FxStatus {
  loading: number;
  unavailable: number;
  latestTs: number;
}

/**
 * Per-currency load state for the footer and the cell placeholders. The rates
 * map above already subscribes this pane to the same coordinator keys, so
 * reading the entries here re-renders with it.
 */
function readFxStatus(currencies: readonly MajorCurrency[], rates: Map<string, number>): FxStatus {
  const coordinator = getSharedMarketDataCoordinator();
  let loading = 0;
  let unavailable = 0;
  let latestTs = 0;
  for (const currency of currencies) {
    if (currency === "USD") continue;
    const entry = coordinator?.getFxEntry(currency) ?? null;
    if (entry?.phase === "loading") loading += 1;
    else if (!rates.has(currency)) unavailable += 1;
    latestTs = Math.max(latestTs, entry?.fetchedAt ?? 0);
  }
  return { loading, unavailable, latestTs };
}

type FxSortPreference = StackSortPreference<string>;

function compareFxRows(
  left: MajorCurrency,
  right: MajorCurrency,
  columnId: string,
  rates: Map<string, number>,
): number {
  if (columnId === "base") return left.localeCompare(right);
  const quote = columnId as MajorCurrency;
  if (left === quote && right === quote) return left.localeCompare(right);
  if (left === quote) return -1;
  if (right === quote) return 1;
  const leftBase = rates.get(left);
  const rightBase = rates.get(right);
  const quoteRate = rates.get(quote);
  const leftRate = leftBase != null && quoteRate != null ? leftBase / quoteRate : null;
  const rightRate = rightBase != null && quoteRate != null ? rightBase / quoteRate : null;
  if (leftRate == null && rightRate == null) return left.localeCompare(right);
  if (leftRate == null) return 1;
  if (rightRate == null) return -1;
  return leftRate - rightRate || left.localeCompare(right);
}

function FxMatrixPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const [savedCurrencies] = usePaneSettingValue<string[]>("currencies", NO_SAVED_CURRENCIES);
  const currencies = useMemo(() => resolveCurrencies(savedCurrencies), [savedCurrencies]);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<FxSortPreference>({ columnId: "base", direction: "asc" });

  const rates = useFxRatesMap(currencies);
  const status = useMemo(() => readFxStatus(currencies, rates), [currencies, rates]);
  const sortedCurrencies = useMemo(
    () => sortStackItems(currencies, sortPreference, (left, right, columnId) =>
      compareFxRows(left, right, columnId, rates),
    ),
    [currencies, rates, sortPreference],
  );

  const refresh = useCallback(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    // A rate that is still fresh is left alone by the coordinator; a failed one
    // is retried, which is the case that matters here.
    for (const currency of currencies) {
      if (currency === "USD") continue;
      void coordinator.loadFxRate(currency).catch(() => {});
    }
  }, [currencies]);

  useAutoRefresh(status.latestTs || null, refresh);

  const columns = useMemo<DataTableColumn[]>(() => [
    { id: "base", label: "", width: BASE_COLUMN_WIDTH, align: "left" },
    ...currencies.map((currency) => ({
      id: currency,
      label: currency,
      width: RATE_COLUMN_WIDTH,
      align: "right" as const,
    })),
  ], [currencies]);

  const renderCell = useCallback((
    row: MajorCurrency,
    column: DataTableColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    if (column.id === "base") {
      return {
        text: row,
        color: selectedColor ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    }

    const quoteCurrency = column.id as MajorCurrency;
    const dimmed = selectedColor ?? colors.textDim;
    if (row === quoteCurrency) return { text: formatRate(1, quoteCurrency), color: dimmed };

    const base = rates.get(row);
    const quote = rates.get(quoteCurrency);
    if (base == null || quote == null) {
      // A missing leg must never fall back to parity: 1.0000 on EUR/JPY reads
      // as a real rate.
      const pending = status.loading > 0;
      return { text: pending ? "…" : "—", color: dimmed };
    }
    return { text: formatRate(base / quote, quoteCurrency), color: selectedColor ?? colors.text };
  }, [rates, status.loading]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    refresh();
    return true;
  }, [refresh]);

  const updatedAgo = useUpdatedAgo(status.latestTs || null);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextStackSortPreference(current, columnId, "asc"));
  }, []);

  usePaneFooter(FX_MATRIX_PANE_ID, () => {
    const info: PaneFooterSegment[] = [];
    if (status.loading > 0) info.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    if (status.unavailable > 0) {
      info.push({
        id: "unavailable",
        parts: [{ text: `${status.unavailable} unavailable`, tone: "warning" }],
      });
    }
    if (updatedAgo) info.push({ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" }] });
    return { info };
  }, [status.loading, status.unavailable, updatedAgo]);

  if (status.loading > 0 && rates.size <= 1 && dataProvider) {
    return (
      <Box width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading FX rates..." />
      </Box>
    );
  }

  return (
    <DataTableView<MajorCurrency>
      focused={focused}
      selection={{
        kind: "id",
        selectedId: selectedCurrency ?? sortedCurrencies[0] ?? null,
        getId: (row) => row,
        onChange: (id) => setSelectedCurrency(id),
      }}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={dataProvider ? sortedCurrencies : []}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row) => row}
      renderCell={renderCell}
      onRootKeyDown={handleKeyDown}
      emptyStateTitle="No market data provider connected."
    />
  );
}

export const fxMatrixModule: PluginModule = {
  panes: [
    {
      id: FX_MATRIX_PANE_ID,
      name: "FX Cross Rates",
      icon: "F",
      component: FxMatrixPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 105, height: 14 },
      tableExport: true,
      settings: (context) => ({
        title: "FX Cross Rates Settings",
        values: {
          currencies: resolveCurrencies(context.settings.currencies as string[] | undefined),
        },
        fields: [{
          key: "currencies",
          label: "Currencies",
          type: "ordered-multi-select",
          options: MAJOR_CURRENCIES.map((currency) => ({ value: currency, label: currency })),
        }],
      }),
    },
  ],

  paneTemplates: [
    {
      id: "fx-matrix-pane",
      paneId: FX_MATRIX_PANE_ID,
      label: "FX Cross Rates",
      description: "Currency cross-rate matrix for major FX pairs.",
      keywords: ["fx", "forex", "currency", "exchange", "rates", "cross", "matrix"],
      shortcut: { prefix: "FXC" },
    },
  ],
};
