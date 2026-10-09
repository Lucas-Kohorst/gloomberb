import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableStackView,
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneNoticeFooter,
  usePaneStatusFooter,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource } from "../../../react/async-resource";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { usePluginPaneState } from "../../runtime";
import { fetchLoanSurvey } from "./client";
import {
  formatNetChange,
  formatNetPercent,
  loanSurveyRows,
  surveyAsOf,
  type LoanSurveyHistory,
  type LoanSurveyQuarter,
  type LoanSurveyRow,
} from "./model";

const EMPTY_SERIES: LoanSurveyHistory[] = [];
const EMPTY_NOTICES: string[] = [];

const SERIES_COLUMNS: DataTableColumn[] = [
  { id: "name", label: "Series", width: 20, flexGrow: 1, align: "left" },
  { id: "quarter", label: "Quarter", width: 9, align: "left" },
  { id: "net", label: "Net %", width: 8, align: "right" },
  { id: "previous", label: "Previous", width: 10, align: "right" },
  { id: "change", label: "Change", width: 9, align: "right" },
];

const HISTORY_COLUMNS: DataTableColumn[] = [
  { id: "quarter", label: "Quarter", width: 9, flexGrow: 1, align: "left" },
  { id: "net", label: "Net %", width: 8, align: "right" },
  { id: "previous", label: "Previous", width: 10, align: "right" },
  { id: "change", label: "Change", width: 9, align: "right" },
];

function tighteningColor(value: number | null): string {
  if (value == null || value === 0) return colors.textMuted;
  return value > 0 ? colors.negative : colors.positive;
}

function levelCell(value: number | null): DataTableCell {
  return { text: formatNetPercent(value), value, color: tighteningColor(value) };
}

function changeCell(value: number | null): DataTableCell {
  return { text: formatNetChange(value), value, color: tighteningColor(value) };
}

function seriesCell(row: LoanSurveyRow, columnId: string): DataTableCell {
  switch (columnId) {
    case "name":
      return { text: row.name, color: colors.textBright };
    case "quarter":
      return { text: row.quarter, color: colors.textMuted };
    case "net":
      return levelCell(row.netPercent);
    case "previous":
      return levelCell(row.previous);
    case "change":
      return changeCell(row.change);
    default:
      return { text: "" };
  }
}

function historyCell(row: LoanSurveyQuarter, columnId: string): DataTableCell {
  switch (columnId) {
    case "quarter":
      return { text: row.quarter, color: colors.textMuted };
    case "net":
      return levelCell(row.netPercent);
    case "previous":
      return levelCell(row.previous);
    case "change":
      return changeCell(row.change);
    default:
      return { text: "" };
  }
}

export function LoanSurveyPane({ focused, width, height, nested = false }: Pick<PaneProps, "width" | "height" | "focused"> & { nested?: boolean }) {
  const resource = useAsyncResource(fetchLoanSurvey);
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>(nested ? "survey-selected" : "selected", null);
  const [openId, setOpenId] = usePluginPaneState<string | null>(nested ? "survey-open" : "open", null);
  const [historyIndex, setHistoryIndex] = useState(0);
  const histories = resource.data?.series ?? EMPTY_SERIES;
  const [search, setSearch] = usePluginPaneState(nested ? "survey-query" : "series", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = loanSurveyRows(histories);
    return needle ? all.filter((row) => row.name.toLowerCase().includes(needle)) : all;
  }, [histories, needle]);
  const queryBar = <QueryBar width={width} search={{ value: search, onChange: setSearch, placeholder: "series", focused, ...searchProps }} />;
  const quarter = surveyAsOf(rows);
  const openRow = rows.find((row) => row.id === openId) ?? null;

  useEffect(() => {
    if (rows.length === 0) return;
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]!.id);
  }, [rows, selectedId, setSelectedId]);

  useEffect(() => {
    setHistoryIndex(0);
  }, [openRow?.id]);

  const reload = useCallback(() => {
    void resource.reload();
  }, [resource.reload]);
  useAutoRefresh(resource.updatedAt, reload);
  usePaneRefreshKey(reload, { focused, enabled: !searchActive });
  usePaneNoticeFooter({
    registrationId: "loan-survey:notices",
    focused,
    notices: resource.data?.errors ?? EMPTY_NOTICES,
  });
  usePaneStatusFooter({
    registrationId: "loan-survey",
    loading: resource.loading,
    error: rows.length > 0 ? resource.error : null,
    info: quarter ? [{ id: "quarter", parts: [{ text: quarter, tone: "muted" }] }] : [],
  });

  const renderSeriesCell = useCallback((row: LoanSurveyRow, column: DataTableColumn): DataTableCell => (
    seriesCell(row, column.id)
  ), []);
  const renderHistoryCell = useCallback((row: LoanSurveyQuarter, column: DataTableColumn): DataTableCell => (
    historyCell(row, column.id)
  ), []);

  if (rows.length === 0 && !needle) {
    return (
      <Box width={width} height={height} flexDirection="column">
        <PaneStatusBody
          loading={resource.loading}
          error={resource.error}
          empty={!resource.loading && !resource.error}
          subject="loan survey"
          emptyTitle="No survey observations."
        />
      </Box>
    );
  }

  return (
    <DataTableStackView<LoanSurveyRow>
      focused={focused && !searchActive}
      rootBefore={queryBar}
      detailOpen={openRow != null}
      onBack={() => setOpenId(null)}
      detailTitle={openRow?.name}
      detailContent={openRow ? (
        <DataTableView<LoanSurveyQuarter>
          focused={focused}
          rootWidth={width}
          rootHeight={Math.max(1, height - 1)}
          columns={HISTORY_COLUMNS}
          items={openRow.recent}
          getItemKey={(row) => row.date}
          renderCell={renderHistoryCell}
          selection={{
            kind: "index",
            selectedIndex: historyIndex,
            onChange: (index) => setHistoryIndex(index),
          }}
          sortColumnId={null}
          sortDirection="desc"
          selectedTextOverridesCellColor
          emptyStateTitle="No survey observations."
        />
      ) : null}
      rootWidth={width}
      rootHeight={height}
      columns={SERIES_COLUMNS}
      items={rows}
      getItemKey={(row) => row.id}
      renderCell={renderSeriesCell}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={(row) => setOpenId(row.id)}
      sortColumnId={null}
      sortDirection="desc"
      selectedTextOverridesCellColor
      emptyStateTitle={needle ? "No matching series." : "No survey observations."}
    />
  );
}
