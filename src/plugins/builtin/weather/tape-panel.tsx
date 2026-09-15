import { useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { colors } from "../../../theme/colors";
import type { ConfirmedExtremes } from "./hvt";
import type { LayerRow } from "./layers";
import type { ObservationPrint } from "./observation-tape";
import { applySortPreference, nextSortPreference, type SortComparableValue, type SortPreference } from "../../../utils/sort-values";

function formatTemp(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)}`;
}

function formatLocal(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms)).replace(",", "");
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

interface TapeRow extends ObservationPrint {
  id: string;
}

type TapeColumnId = "when" | "kind" | "temp" | "counts" | "label";
interface TapeColumn extends DataTableColumn { id: TapeColumnId }

type LayerColumnId = "group" | "label" | "value" | "detail" | "counts";
interface LayerColumn extends DataTableColumn { id: LayerColumnId }

function tapeValue(row: TapeRow, columnId: TapeColumnId): SortComparableValue {
  switch (columnId) {
    case "when": return row.validToMs;
    case "kind": return row.kind;
    case "temp": return row.tempF;
    case "counts": return row.countsForToday == null ? "straddle" : row.countsForToday ? "today" : "no";
    case "label": return row.label;
  }
}

export function TapePanel({
  prints,
  layers,
  extremes,
  timeZone,
  width,
  height,
}: {
  prints: readonly ObservationPrint[];
  layers: readonly LayerRow[];
  extremes: ConfirmedExtremes;
  timeZone: string;
  width: number;
  height: number;
}) {
  const [tapeSort, setTapeSort] = useState<SortPreference<TapeColumnId>>({ columnId: "when", direction: "desc" });
  const [layerSort, setLayerSort] = useState<SortPreference<LayerColumnId>>({ columnId: "group", direction: "asc" });
  const [selectedPrint, setSelectedPrint] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);

  const tapeRows = useMemo<TapeRow[]>(
    () => prints.map((print, index) => ({ ...print, id: `${print.kind}-${print.validToMs}-${index}` })),
    [prints],
  );
  const sortedTape = useMemo(() => applySortPreference(tapeRows, tapeSort, tapeValue), [tapeRows, tapeSort]);
  const sortedLayers = useMemo(
    () => applySortPreference(layers, layerSort, (row, columnId) => row[columnId]),
    [layers, layerSort],
  );

  const tapeColumns = useMemo<TapeColumn[]>(() => [
    { id: "when", label: "WHEN", width: 12, align: "left" },
    { id: "kind", label: "KIND", width: 14, align: "left" },
    { id: "temp", label: "°F", width: 5, align: "right" },
    { id: "counts", label: "DAY", width: 8, align: "left" },
    { id: "label", label: "NOTE", width: 16, align: "left", flexGrow: 1 },
  ], []);
  const layerColumns = useMemo<LayerColumn[]>(() => [
    { id: "group", label: "GROUP", width: 14, align: "left" },
    { id: "label", label: "LAYER", width: 14, align: "left" },
    { id: "value", label: "VALUE", width: 10, align: "right" },
    { id: "detail", label: "DETAIL", width: 16, align: "left", flexGrow: 1 },
    { id: "counts", label: "DAY", width: 8, align: "left" },
  ], []);

  const layerHeight = Math.max(8, Math.min(sortedLayers.length + 1, Math.floor(height * 0.45)));
  const tapeHeight = Math.max(6, height - layerHeight - 3);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box paddingX={1} height={2} flexShrink={0}>
        <Text fg={colors.text}>
          {`Wethr high ${formatTemp(extremes.wethrHigh)} · low ${formatTemp(extremes.wethrLow)}`}
          {extremes.potentialHigh != null ? ` · potential ${Math.round(extremes.potentialHigh)}` : ""}
          {extremes.hvtMs != null ? ` · HVT ${formatLocal(extremes.hvtMs, timeZone)}` : ""}
        </Text>
      </Box>
      <DataTableView<LayerRow, LayerColumn>
        focused={false}
        rootWidth={width}
        rootHeight={layerHeight}
        selection={{ kind: "id", selectedId: selectedLayer, getId: (row) => row.id, onChange: setSelectedLayer }}
        columns={layerColumns}
        items={sortedLayers}
        sortColumnId={layerSort.columnId}
        sortDirection={layerSort.direction}
        onHeaderClick={(columnId) => setLayerSort((current) => nextSortPreference(current, columnId as LayerColumnId))}
        getItemKey={(row) => row.id}
        renderCell={(row, column, _index, rowState): DataTableCell => ({
          text: String(row[column.id]),
          color: rowState.selected ? colors.selectedText : colors.text,
        })}
      />
      <DataTableView<TapeRow, TapeColumn>
        focused={false}
        rootWidth={width}
        rootHeight={tapeHeight}
        selection={{ kind: "id", selectedId: selectedPrint, getId: (row) => row.id, onChange: setSelectedPrint }}
        columns={tapeColumns}
        items={sortedTape}
        sortColumnId={tapeSort.columnId}
        sortDirection={tapeSort.direction}
        onHeaderClick={(columnId) => setTapeSort((current) => nextSortPreference(current, columnId as TapeColumnId))}
        getItemKey={(row) => row.id}
        emptyStateTitle="No METAR, DSM, or CLI prints yet."
        renderCell={(row, column, _index, rowState): DataTableCell => {
          const selected = rowState.selected ? colors.selectedText : undefined;
          if (column.id === "when") return { text: formatLocal(row.validToMs, timeZone), color: selected ?? colors.text };
          if (column.id === "kind") return { text: row.kind, color: selected ?? colors.textMuted };
          if (column.id === "temp") return { text: formatTemp(row.tempF), color: selected ?? colors.text };
          if (column.id === "counts") {
            const text = row.countsForToday == null ? "straddle" : row.countsForToday ? "today" : "no";
            return { text, color: selected ?? (row.countsForToday === true ? colors.positive : colors.textMuted) };
          }
          return { text: row.label, color: selected ?? colors.textDim };
        }}
      />
    </Box>
  );
}
