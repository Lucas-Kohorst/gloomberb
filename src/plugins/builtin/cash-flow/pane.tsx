import { useCallback, useEffect, useMemo, useState } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableView,
  EmptyState,
  Spinner,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { usePaneFooterHintBindings } from "../shared/pane-footer";
import { handleRefreshKey, loadingErrorFooterInfo } from "../shared/table-pane";
import { usePaneSettingValue } from "../../../state/app/context";
import { colors, priceColor } from "../../../theme/colors";
import { compareSortValues, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAssetData } from "../../runtime";
import type { FinancialStatement, TickerFinancials } from "../../../types/financials";
import { useBoundTicker, useTickerRequest } from "../shared/ticker-request";
import {
  buildCashFlowColumns,
  buildCashFlowRows,
  formatCashFlowValue,
  resolveCashFlowPeriod,
  selectCashFlowStatements,
  statementCashFlowValue,
  type CashFlowColumn,
  type CashFlowPeriod,
  type CashFlowTableRow,
} from "./model";
import { CASH_FLOW_DEFAULTS } from "./settings";

const EMPTY_STATEMENTS: FinancialStatement[] = [];

export function CashFlowPane({
  focused,
  width,
  height,
}: {
  focused: boolean;
  width: number;
  height: number;
}) {
  const dataProvider = useAssetData();
  const { symbol, exchange, currency } = useBoundTicker();
  const [requestedPeriod] = usePaneSettingValue<CashFlowPeriod>(
    "period",
    CASH_FLOW_DEFAULTS.period,
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [sortPreference, setSortPreference] = useState<SortPreference>({ columnId: null, direction: "asc" });

  const loader = useCallback(
    (nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
      if (!dataProvider) throw new Error("Financial data unavailable");
      return dataProvider.getTickerFinancials(
        nextSymbol,
        nextExchange,
        forceRefresh ? { cacheMode: "refresh" } : undefined,
      );
    },
    [dataProvider],
  );
  const { data, loading, error, reload } = useTickerRequest<TickerFinancials>(
    loader,
    symbol,
    exchange,
  );

  const annualStatements = data?.annualStatements ?? EMPTY_STATEMENTS;
  const quarterlyStatements = data?.quarterlyStatements ?? EMPTY_STATEMENTS;
  const period = resolveCashFlowPeriod(
    requestedPeriod,
    annualStatements.length > 0,
    quarterlyStatements.length > 0,
  );
  const statements = useMemo(
    () => selectCashFlowStatements(period === "annual" ? annualStatements : quarterlyStatements),
    [annualStatements, period, quarterlyStatements],
  );
  const rows = useMemo(() => buildCashFlowRows(statements), [statements]);
  const columns = useMemo(
    () => buildCashFlowColumns(statements, period),
    [period, statements],
  );
  const activeSortColumn = columns.find((entry) => entry.id === sortPreference.columnId);
  const sortedRows = useMemo(() => {
    if (!activeSortColumn) return rows;
    const result: CashFlowTableRow[] = [];
    let sectionRows: Extract<CashFlowTableRow, { kind: "metric" }>[] = [];
    const flushSection = () => {
      sectionRows = [...sectionRows].sort((left, right) => {
        const leftValue = activeSortColumn.kind === "metric"
          ? left.label
          : statementCashFlowValue(activeSortColumn.statement, left.field);
        const rightValue = activeSortColumn.kind === "metric"
          ? right.label
          : statementCashFlowValue(activeSortColumn.statement, right.field);
        return compareSortValues(leftValue, rightValue, sortPreference.direction);
      });
      result.push(...sectionRows);
      sectionRows = [];
    };
    for (const row of rows) {
      if (row.kind === "section") {
        flushSection();
        result.push(row);
      } else {
        sectionRows.push(row);
      }
    }
    flushSection();
    return result;
  }, [activeSortColumn, rows, sortPreference.direction]);
  const footerHints = useMemo(() => [], []);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedRowId !== null) setSelectedRowId(null);
      return;
    }
    if (!selectedRowId || !rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(rows[0]!.id);
    }
  }, [rows, selectedRowId]);

  usePaneFooter("cash-flow", () => ({
    info: loadingErrorFooterInfo(loading, symbol ? error : null),
    hints: footerHints,
  }), [error, footerHints, loading, symbol]);
  usePaneFooterHintBindings(focused, footerHints);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, reload, { stopPropagation: true });
  }, [reload]);

  const renderCell = useCallback((
    row: CashFlowTableRow,
    column: CashFlowColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    if (column.kind === "metric") {
      if (row.kind === "section") {
        return {
          text: row.label,
          color: colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      }
      return {
        text: row.label,
        color: selectedColor ?? (row.emphasis ? colors.textBright : colors.textDim),
        attributes: row.emphasis ? TextAttributes.BOLD : undefined,
      };
    }

    if (row.kind === "section") {
      return { text: "" };
    }

    const value = statementCashFlowValue(column.statement, row.field);
    return {
      text: formatCashFlowValue(value, currency),
      color: selectedColor ?? (value == null ? colors.textDim : priceColor(value)),
      attributes: row.emphasis ? TextAttributes.BOLD : undefined,
    };
  }, [currency]);

  if (!symbol) {
    return <EmptyState title="No ticker selected." message="Select a ticker to view cash flow." />;
  }
  if (loading && !data) {
    return <Spinner label="Loading cash flow..." />;
  }
  if (error && !data) {
    return <EmptyState title="Cash flow unavailable." message={error} />;
  }
  if (!data || statements.length === 0 || rows.length === 0) {
    return (
      <EmptyState
        title="No cash flow data"
        message={`${symbol} has no ${period} cash flow statements.`}
      />
    );
  }

  return (
    <DataTableView<CashFlowTableRow, CashFlowColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={sortedRows}
      selection={{
        kind: "id",
        selectedId: selectedRowId && rows.some((row) => row.id === selectedRowId)
          ? selectedRowId
          : rows[0]?.id ?? null,
        getId: (row) => row.id,
        onChange: (id) => setSelectedRowId(id),
      }}
      sortColumnId={activeSortColumn?.id ?? null}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(
        current,
        columnId,
        { defaultDirection: columnId === "metric" ? "asc" : "desc" },
      ))}
      onRootKeyDown={handleKeyDown}
      getItemKey={(row) => row.id}
      getRowBackgroundColor={(row) => row.kind === "section" ? colors.panel : undefined}
      renderCell={renderCell}
      emptyStateTitle="No cash flow data"
      emptyStateMessage={`${symbol} has no ${period} cash flow statements.`}
      showHorizontalScrollbar
      resetScrollKey={`${symbol}:${period}:${statements.map((statement) => statement.date).join(",")}`}
    />
  );
}
