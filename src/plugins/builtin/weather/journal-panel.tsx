import { useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import { DataTableView, EmptyState, type DataTableCell, type DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { journalErrorStats, type JournalCase } from "./journal";
import { applySortPreference, nextSortPreference, type SortComparableValue, type SortPreference } from "../../../utils/sort-values";

type JournalColumnId = "date" | "station" | "method" | "forecast" | "outcome" | "error";
interface JournalColumn extends DataTableColumn { id: JournalColumnId }

function journalValue(row: JournalCase, columnId: JournalColumnId): SortComparableValue {
  switch (columnId) {
    case "date": return row.date;
    case "station": return row.stationId;
    case "method": return row.method;
    case "forecast": return row.forecastF;
    case "outcome": return row.outcomeF;
    case "error": return row.outcomeF == null ? null : row.forecastF - row.outcomeF;
  }
}

export function JournalPanel({
  cases,
  width,
  height,
  selectedId,
  onSelect,
}: {
  cases: readonly JournalCase[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [sort, setSort] = useState<SortPreference<JournalColumnId>>({ columnId: "date", direction: "desc" });
  const rows = useMemo(() => applySortPreference([...cases], sort, journalValue), [cases, sort]);
  const stats = journalErrorStats({ cases: [...cases] });
  const columns = useMemo<JournalColumn[]>(() => [
    { id: "date", label: "DAY", width: 11, align: "left" },
    { id: "station", label: "STN", width: 5, align: "left" },
    { id: "method", label: "METHOD", width: 10, align: "left" },
    { id: "forecast", label: "FCST", width: 5, align: "right" },
    { id: "outcome", label: "OUT", width: 5, align: "right" },
    { id: "error", label: "ERR", width: 5, align: "right", flexGrow: 1 },
  ], []);

  if (cases.length === 0) {
    return (
      <EmptyState
        title="No frozen forecasts."
        hint="Select a city then press f to freeze Wethr high, or k to freeze Kalshi implied."
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box paddingX={1} height={1} flexShrink={0}>
        <Text fg={colors.textMuted}>
          {stats.samples === 0
            ? `${cases.length} frozen · no outcomes yet · press c to record CLI on the selected case`
            : `${stats.samples} outcomes · MAE ${stats.mae.toFixed(1)} · bias ${stats.bias >= 0 ? "+" : ""}${stats.bias.toFixed(1)}`}
        </Text>
      </Box>
      <DataTableView<JournalCase, JournalColumn>
        focused
        rootWidth={width}
        rootHeight={Math.max(1, height - 1)}
        selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: onSelect }}
        columns={columns}
        items={rows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as JournalColumnId, columnId === "forecast" || columnId === "outcome" || columnId === "error" ? "desc" : "desc"))}
        getItemKey={(row) => row.id}
        renderCell={(row, column, _index, rowState): DataTableCell => {
          const selected = rowState.selected ? colors.selectedText : undefined;
          if (column.id === "date") return { text: row.date, color: selected ?? colors.textBright };
          if (column.id === "station") return { text: row.stationId, color: selected ?? colors.text };
          if (column.id === "method") return { text: row.method, color: selected ?? colors.textMuted };
          if (column.id === "forecast") return { text: String(Math.round(row.forecastF)), color: selected ?? colors.text };
          if (column.id === "outcome") return { text: row.outcomeF == null ? "—" : String(Math.round(row.outcomeF)), color: selected ?? colors.text };
          const error = row.outcomeF == null ? null : row.forecastF - row.outcomeF;
          return { text: error == null ? "—" : `${error > 0 ? "+" : ""}${error.toFixed(1)}`, color: selected ?? colors.text };
        }}
      />
    </Box>
  );
}
