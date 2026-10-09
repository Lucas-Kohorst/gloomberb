import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DataTableView,
  EmptyState,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource } from "../../../react/async-resource";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { usePluginPaneState } from "../../runtime";
import { fetchNordicRates } from "./client";
import {
  BOND_COLUMNS,
  MORTGAGE_COLUMNS,
  NORDIC_RATES_PANE_ID,
  formatRate,
  type BondColumn,
  type MortgageColumn,
  type NordicBondYield,
  type NordicMortgageRate,
  type NordicRatesTab,
} from "./model";

const TABS = [
  { label: "Mortgage", value: "mortgage" },
  { label: "Bond", value: "bond" },
];
const EMPTY_MORTGAGES: NordicMortgageRate[] = [];
const EMPTY_YIELDS: NordicBondYield[] = [];

function tone(selected: boolean, bright: boolean): string {
  if (selected) return colors.selectedText;
  return bright ? colors.textBright : colors.text;
}

export function NordicRatesPane({ focused, width, height }: PaneProps) {
  const request = useCallback((_force: boolean) => fetchNordicRates(), []);
  const resource = useAsyncResource(request);
  const data = resource.data;
  const [storedTab, setTab] = usePluginPaneState<NordicRatesTab>("tab", "mortgage");
  const tab: NordicRatesTab = storedTab === "bond" ? "bond" : "mortgage";
  const [mortgageId, setMortgageId] = useState<string | null>(null);
  const [bondId, setBondId] = useState<string | null>(null);
  const [search, setSearch] = usePluginPaneState("rate", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = search.trim().toLowerCase();
  const mortgages = useMemo(() => {
    const all = data?.mortgages ?? EMPTY_MORTGAGES;
    return needle ? all.filter((row) => `${row.lender} ${row.term}`.toLowerCase().includes(needle)) : all;
  }, [data?.mortgages, needle]);
  const bondYields = useMemo(() => {
    const all = data?.yields ?? EMPTY_YIELDS;
    return needle ? all.filter((row) => `${row.segment} ${row.maturity}`.toLowerCase().includes(needle)) : all;
  }, [data?.yields, needle]);
  const mortgageTab = tab === "mortgage";
  const queryBar = <QueryBar width={width} search={{ value: search, onChange: setSearch, placeholder: mortgageTab ? "lender" : "segment", focused, ...searchProps }} />;
  const rows = mortgageTab ? mortgages : bondYields;
  const selectedId = mortgageTab ? mortgageId : bondId;
  const setSelectedId = mortgageTab ? setMortgageId : setBondId;
  const tabError = mortgageTab ? data?.mortgageError ?? null : data?.yieldError ?? null;

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId, setSelectedId]);

  const refresh = useCallback(() => {
    void resource.reload();
  }, [resource.reload]);
  useAutoRefresh(resource.updatedAt, refresh);
  usePaneRefreshKey(refresh, { focused, enabled: !searchActive });

  // Mortgage quotes publish no date. The bond grid's reporting date is the footer.
  const info = useMemo<PaneFooterSegment[]>(() => (
    tab === "bond" && data?.asOf ? [{ id: "as-of", parts: [{ text: data.asOf, tone: "muted" }] }] : []
  ), [data?.asOf, tab]);
  const { strip, rows: tabRows } = usePaneTabs({
    tabs: TABS,
    activeValue: tab,
    onSelect: (value) => setTab(value === "bond" ? "bond" : "mortgage"),
    focused,
  });
  usePaneStatusFooter({
    registrationId: NORDIC_RATES_PANE_ID,
    loading: resource.loading,
    error: resource.error ?? tabError,
    info,
  });

  const renderMortgageCell = useCallback((
    row: NordicMortgageRate,
    column: MortgageColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (column.id === "lender") {
      return { text: row.lender, color: tone(rowState.selected, true), attributes: TextAttributes.BOLD };
    }
    if (column.id === "term") return { text: row.term, color: tone(rowState.selected, false) };
    return { text: formatRate(row.rate), value: row.rate, color: tone(rowState.selected, false) };
  }, []);
  const renderBondCell = useCallback((
    row: NordicBondYield,
    column: BondColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (column.id === "segment") {
      return { text: row.segment, color: tone(rowState.selected, true), attributes: TextAttributes.BOLD };
    }
    if (column.id === "maturity") return { text: row.maturity, color: tone(rowState.selected, false) };
    return { text: formatRate(row.yield), value: row.yield, color: tone(rowState.selected, false) };
  }, []);

  const bodyHeight = Math.max(1, height - tabRows);
  const frame = (body: ReactNode) => (
    <Box flexDirection="column" width={width} height={height}>{strip}{body}</Box>
  );

  if (!data) {
    return frame(resource.error && !resource.loading
      ? <Box width={width} height={bodyHeight} alignItems="center" justifyContent="center"><EmptyState title="Nordic rates unavailable." /></Box>
      : <PaneStatusBody loading align="center" width={width} height={bodyHeight} />);
  }
  if (tabError && rows.length === 0 && !needle) {
    return frame(
      <Box width={width} height={bodyHeight} alignItems="center" justifyContent="center">
        <EmptyState title={mortgageTab ? "Mortgage rates unavailable." : "Bond yields unavailable."} />
      </Box>,
    );
  }

  return frame(mortgageTab ? (
    <DataTableView
      focused={focused && !searchActive}
      rootWidth={width}
      rootHeight={bodyHeight}
      rootBefore={queryBar}
      selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: setMortgageId }}
      columns={[...MORTGAGE_COLUMNS]}
      items={mortgages}
      sortColumnId={null}
      sortDirection="asc"
      getItemKey={(row) => row.id}
      renderCell={renderMortgageCell}
      emptyStateTitle={needle ? "No matching lenders." : "No mortgage rates published."}
    />
  ) : (
    <DataTableView
      focused={focused && !searchActive}
      rootWidth={width}
      rootHeight={bodyHeight}
      rootBefore={queryBar}
      selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: setBondId }}
      columns={[...BOND_COLUMNS]}
      items={bondYields}
      sortColumnId={null}
      sortDirection="asc"
      getItemKey={(row) => row.id}
      renderCell={renderBondCell}
      emptyStateTitle={needle ? "No matching yields." : "No bond yields published."}
    />
  ));
}
