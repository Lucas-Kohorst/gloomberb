import { useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import { DataTableView, EmptyState, type DataTableCell, type DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import type { AnalogDay } from "./analogs";
import { applySortPreference, nextSortPreference, type SortComparableValue, type SortPreference } from "../../../utils/sort-values";

type AnalogColumnId = "date" | "rmse" | "hours" | "high" | "remain";
interface AnalogColumn extends DataTableColumn { id: AnalogColumnId }

function analogValue(row: AnalogDay, columnId: AnalogColumnId): SortComparableValue {
  switch (columnId) {
    case "date": return row.date;
    case "rmse": return row.rmse;
    case "hours": return row.hoursCompared;
    case "high": return row.analogHigh;
    case "remain": return row.remainingHigh;
  }
}

export function AnalogsPanel({
  stationLabel,
  analogs,
  error,
  width,
  height,
}: {
  stationLabel: string;
  analogs: readonly AnalogDay[];
  error: string | null;
  width: number;
  height: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortPreference<AnalogColumnId>>({ columnId: "rmse", direction: "asc" });
  const rows = useMemo(() => applySortPreference([...analogs], sort, analogValue), [analogs, sort]);
  const columns = useMemo<AnalogColumn[]>(() => [
    { id: "date", label: "DAY", width: 12, align: "left", flexGrow: 1 },
    { id: "rmse", label: "RMSE", width: 6, align: "right" },
    { id: "hours", label: "HRS", width: 4, align: "right" },
    { id: "high", label: "HIGH", width: 6, align: "right" },
    { id: "remain", label: "REST", width: 6, align: "right" },
  ], []);

  if (error) {
    return <EmptyState title="Analogs unavailable." message={error} hint="Press r to retry." />;
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box paddingX={1} height={1} flexShrink={0}>
        <Text fg={colors.textMuted}>{`${stationLabel} · closest prior settlement-day trajectories`}</Text>
      </Box>
      <DataTableView<AnalogDay, AnalogColumn>
        focused
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        selection={{ kind: "id", selectedId, getId: (row) => row.date, onChange: setSelectedId }}
        columns={columns}
        items={rows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as AnalogColumnId, columnId === "date" ? "desc" : "asc"))}
        getItemKey={(row) => row.date}
        emptyStateTitle="Not enough hourly history yet."
        emptyStateHint="Open a station and wait for IEM ASOS. Need 3+ overlapping hours."
        renderCell={(row, column, _index, rowState): DataTableCell => {
          const selected = rowState.selected ? colors.selectedText : undefined;
          if (column.id === "date") return { text: row.date, color: selected ?? colors.textBright };
          if (column.id === "rmse") return { text: row.rmse.toFixed(1), color: selected ?? colors.text };
          if (column.id === "hours") return { text: String(row.hoursCompared), color: selected ?? colors.textDim };
          if (column.id === "high") return { text: row.analogHigh == null ? "—" : String(Math.round(row.analogHigh)), color: selected ?? colors.text };
          return { text: row.remainingHigh == null ? "—" : String(Math.round(row.remainingHigh)), color: selected ?? colors.text };
        }}
      />
    </Box>
  );
}
