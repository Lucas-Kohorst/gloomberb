import { useCallback, useEffect, useMemo } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePluginPaneState } from "../../../public/react";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { fetchEnergyOutlook } from "./client";
import {
  formatEnergyValue,
  type EnergyTab,
  type ImportRow,
  type OutlookRow,
  type OutageRow,
} from "./model";

const OUTLOOK_COLUMNS: DataTableColumn[] = [
  { id: "name", label: "Name", width: 28, flexGrow: 3, align: "left" },
  { id: "period", label: "Period", width: 8, align: "left" },
  { id: "value", label: "Value", width: 10, align: "right" },
  { id: "previous", label: "Previous", width: 10, align: "right" },
  { id: "unit", label: "Unit", width: 18, flexGrow: 2, align: "left" },
];

const IMPORT_COLUMNS: DataTableColumn[] = [
  { id: "origin", label: "Origin", width: 24, flexGrow: 2, align: "left" },
  { id: "volume", label: "Volume", width: 12, align: "right" },
  { id: "unit", label: "Unit", width: 18, flexGrow: 1, align: "left" },
];

const OUTAGE_COLUMNS: DataTableColumn[] = [
  { id: "facility", label: "Plant", width: 28, flexGrow: 2, align: "left" },
  { id: "outage", label: "Outage MW", width: 12, align: "right" },
  { id: "capacity", label: "Capacity MW", width: 12, align: "right" },
  { id: "percent", label: "Out %", width: 8, align: "right" },
];

const TABS: { value: EnergyTab; label: string }[] = [
  { value: "outlook", label: "Outlook" },
  { value: "imports", label: "Imports" },
  { value: "outages", label: "Outages" },
];

function tabSubject(tab: EnergyTab): string {
  if (tab === "imports") return "Crude imports";
  if (tab === "outages") return "Nuclear outages";
  return "Energy outlook";
}

function tabEmpty(tab: EnergyTab): string {
  if (tab === "imports") return "No crude imports for the latest month.";
  if (tab === "outages") return "No nuclear outages reported.";
  return "No outlook figures.";
}

function rowLabel(row: OutlookRow | ImportRow | OutageRow): string {
  if ("origin" in row) return row.origin;
  if ("facility" in row) return row.facility;
  return row.name;
}

function EnergyTable<T extends { id: string }>({
  columns, rows, selectedId, onSelect, focused, width, height, emptyTitle, renderCell,
}: {
  columns: DataTableColumn[];
  rows: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  focused: boolean;
  width: number;
  height: number;
  emptyTitle: string;
  renderCell: (row: T, column: DataTableColumn) => DataTableCell;
}) {
  return (
    <DataTableView
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rows}
      getItemKey={(row) => row.id}
      selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: (id) => onSelect(id) }}
      sortColumnId={null}
      sortDirection="asc"
      selectedTextOverridesCellColor
      renderCell={renderCell}
      emptyStateTitle={emptyTitle}
    />
  );
}

export function EnergyOutlookPane({ width, height, focused }: PaneProps) {
  const colors = useThemeColors();
  const [savedTab, setTab] = usePluginPaneState<EnergyTab>("tab", "outlook");
  const [search, setSearch] = usePluginPaneState("query", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const loadBoard = useCallback(() => fetchEnergyOutlook(undefined, savedTab), [savedTab]);
  const resource = useAsyncResource(loadBoard, { keepPreviousData: true });
  const data = resource.data;
  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => { void resource.reload(); }, { focused, enabled: !searchActive });

  const [outlookId, setOutlookId] = usePluginPaneState<string | null>("outlook-row", null);
  const [importId, setImportId] = usePluginPaneState<string | null>("import-row", null);
  const [outageId, setOutageId] = usePluginPaneState<string | null>("outage-row", null);

  const tabs = useMemo(
    () => TABS.filter((tab) => tab.value !== "outages" || !data || data.outages.available),
    [data],
  );
  const active: EnergyTab = tabs.some((tab) => tab.value === savedTab) ? savedTab : "outlook";
  const { strip, rows: tabRows } = usePaneTabs({
    tabs,
    activeValue: active,
    onSelect: (value) => setTab(value as EnergyTab),
    focused,
    dense: true,
  });

  const outlook = data?.outlook.rows ?? [];
  const imports = data?.imports.rows ?? [];
  const outages = data?.outages.rows ?? [];
  const selectedId = active === "imports" ? importId : active === "outages" ? outageId : outlookId;
  const source = active === "imports" ? imports : active === "outages" ? outages : outlook;
  const needle = search.trim().toLowerCase();
  const rows = needle ? source.filter((row) => rowLabel(row).toLowerCase().includes(needle)) : source;
  const queryBar = (
    <QueryBar width={width} search={{ value: search, onChange: setSearch, placeholder: active === "imports" ? "origin" : active === "outages" ? "plant" : "series", focused, ...searchProps }} />
  );
  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    const next = rows[0]?.id ?? null;
    if (next === selectedId) return;
    if (active === "imports") setImportId(next);
    else if (active === "outages") setOutageId(next);
    else setOutlookId(next);
  }, [active, rows, selectedId, setImportId, setOutageId, setOutlookId]);

  const period = active === "imports"
    ? data?.imports.period ?? null
    : active === "outages"
      ? (outages.find((row) => row.id === outageId) ?? outages[0])?.period ?? null
      : (outlook.find((row) => row.id === outlookId) ?? outlook[0])?.period ?? null;
  const sectionError = !data ? resource.error
    : active === "imports" ? data.imports.error
      : active === "outages" ? data.outages.error
        : data.outlook.error;
  const showRows = source.length > 0;
  const info = useMemo(
    () => period && showRows ? [{ id: "period", parts: [{ text: period, tone: "muted" as const }] }] : [],
    [period, showRows],
  );
  usePaneStatusFooter({
    registrationId: "energy-outlook",
    loading: resource.loading,
    error: showRows ? sectionError ?? resource.error : null,
    info,
  });

  const bodyHeight = Math.max(1, height - tabRows - 1);
  const renderOutlook = useCallback((row: OutlookRow, column: DataTableColumn): DataTableCell => {
    const number = (value: number | null): DataTableCell => ({ text: formatEnergyValue(value), value, color: colors.text });
    switch (column.id) {
      case "name":
        return { text: row.name, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "period":
        return { text: row.period, color: colors.textMuted };
      case "value":
        return number(row.value);
      case "previous":
        return number(row.previous);
      default:
        return { text: row.unit || "--", color: colors.textDim };
    }
  }, [colors]);
  const renderImport = useCallback((row: ImportRow, column: DataTableColumn): DataTableCell => {
    switch (column.id) {
      case "origin":
        return { text: row.origin, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "volume":
        return { text: formatEnergyValue(row.volume), value: row.volume, color: colors.text };
      default:
        return { text: row.unit || "--", color: colors.textDim };
    }
  }, [colors]);
  const renderOutage = useCallback((row: OutageRow, column: DataTableColumn): DataTableCell => {
    const number = (value: number | null): DataTableCell => ({ text: formatEnergyValue(value), value, color: colors.text });
    switch (column.id) {
      case "facility":
        return { text: row.facility, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "outage":
        return number(row.outage);
      case "capacity":
        return number(row.capacity);
      default:
        return number(row.percent);
    }
  }, [colors]);

  const failed = !!data && !showRows && !!sectionError && !resource.loading;
  const empty = !!data && !showRows && !sectionError && !resource.loading;
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      {strip}
      {queryBar}
      <PaneStatusBody
        loading={resource.loading && !showRows}
        error={!data ? resource.error : failed ? sectionError : null}
        empty={empty}
        emptyTitle={tabEmpty(active)}
        subject={tabSubject(active)}
        width={width}
        height={bodyHeight}
      >
        {data && active === "outlook" ? (
          <EnergyTable columns={OUTLOOK_COLUMNS} rows={rows as OutlookRow[]} selectedId={outlookId} onSelect={setOutlookId}
            focused={focused && !searchActive} width={width} height={bodyHeight} emptyTitle={needle ? "No matching series." : tabEmpty("outlook")} renderCell={renderOutlook} />
        ) : null}
        {data && active === "imports" ? (
          <EnergyTable columns={IMPORT_COLUMNS} rows={rows as ImportRow[]} selectedId={importId} onSelect={setImportId}
            focused={focused && !searchActive} width={width} height={bodyHeight} emptyTitle={needle ? "No matching origins." : tabEmpty("imports")} renderCell={renderImport} />
        ) : null}
        {data && active === "outages" ? (
          <EnergyTable columns={OUTAGE_COLUMNS} rows={rows as OutageRow[]} selectedId={outageId} onSelect={setOutageId}
            focused={focused && !searchActive} width={width} height={bodyHeight} emptyTitle={needle ? "No matching plants." : tabEmpty("outages")} renderCell={renderOutage} />
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
