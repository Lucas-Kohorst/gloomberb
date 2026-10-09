import { useCallback, useEffect, useMemo } from "react";
import {
  DataTableView,
  PaneStatusBody,
  usePaneStatusFooter,
  type DataTableCell,
  type DataTableColumn,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePluginPaneState } from "../../../public/react";
import { priceColor } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { fetchFactorReturns } from "./client";
import {
  FACTOR_FIELDS,
  FAMA_FRENCH_PANE_ID,
  formatFactorMonth,
  formatFactorPercent,
  type FactorFieldKey,
  type FactorMonth,
} from "./model";

const COLUMNS: DataTableColumn[] = FACTOR_FIELDS.map((field) => ({
  id: field.key,
  label: field.header,
  width: field.width,
  align: field.align,
  ...(field.key === "month" ? {} : { flexGrow: 1 }),
}));

function percentValue(row: FactorMonth, key: FactorFieldKey): number {
  switch (key) {
    case "marketMinusRf": return row.marketMinusRf;
    case "size": return row.size;
    case "value": return row.value;
    case "rf": return row.rf;
    default: return 0;
  }
}

export function FactorReturnsPane({ width, height, focused }: PaneProps) {
  const palette = useThemeColors();
  const request = useCallback(() => fetchFactorReturns(), []);
  const resource = useAsyncResource(request);
  const data = resource.data;
  const months = data?.months ?? [];
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  useEffect(() => {
    if (selectedId && months.some((row) => row.month === selectedId)) return;
    setSelectedId(months[0]?.month ?? null);
  }, [months, selectedId, setSelectedId]);
  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => void resource.reload(), { focused });
  const info = useMemo<PaneFooterSegment[]>(() => (
    data?.vintage ? [{ id: "vintage", parts: [{ text: data.vintage, tone: "muted" as const }] }] : []
  ), [data?.vintage]);
  usePaneStatusFooter({
    registrationId: FAMA_FRENCH_PANE_ID,
    loading: resource.loading,
    error: data ? resource.error : null,
    info,
  });
  const renderCell = useCallback((row: FactorMonth, column: DataTableColumn): DataTableCell => {
    if (column.id === "month") {
      const text = formatFactorMonth(row.month);
      return { text, value: text, color: palette.text };
    }
    const value = percentValue(row, column.id as FactorFieldKey);
    return { text: formatFactorPercent(value), value, color: priceColor(value, palette) };
  }, [palette]);

  return (
    <Box width={width} height={height} flexDirection="column">
      <PaneStatusBody
        loading={resource.loading && !data}
        error={!data ? resource.error : null}
        subject="Factor returns"
      >
        {data ? (
          <DataTableView
            columns={COLUMNS}
            items={months}
            focused={focused}
            rootWidth={width}
            rootHeight={height}
            selection={{
              kind: "id",
              selectedId,
              getId: (row) => row.month,
              onChange: (id) => setSelectedId(id),
            }}
            onActivate={(row) => setSelectedId(row.month)}
            sortColumnId={null}
            sortDirection="desc"
            getItemKey={(row) => row.month}
            renderCell={renderCell}
            selectedTextOverridesCellColor
            getExportMetadata={() => [["vintage", data.vintage]]}
            emptyStateTitle="No monthly returns."
          />
        ) : null}
      </PaneStatusBody>
    </Box>
  );
}
