import { useMemo, useState } from "react";
import { DataTableView, EmptyState, type DataTableCell, type DataTableColumn } from "../../../components";
import type { PricePoint } from "../../../types/financials";
import { PriceStudyGate, usePriceStudyHistory } from "./history";
import { detectPatterns, type PatternMatch, type PatternType } from "./math";

const COLUMNS: DataTableColumn[] = [
  { id: "type", label: "Type", width: 24, align: "left" },
  { id: "confidence", label: "Confidence", width: 12, align: "right" },
  { id: "dates", label: "Dates", width: 23, align: "left" },
  { id: "description", label: "Description", width: 28, align: "left", flexGrow: 1 },
];

const LABELS: Record<PatternType, string> = {
  "double-top": "Double top",
  "double-bottom": "Double bottom",
  "head-and-shoulders": "Head and shoulders",
  "inv-head-and-shoulders": "Inverse head and shoulders",
  "ascending-triangle": "Ascending triangle",
  "descending-triangle": "Descending triangle",
  "symmetrical-triangle": "Symmetrical triangle",
  "rising-wedge": "Rising wedge",
  "falling-wedge": "Falling wedge",
  "bull-flag": "Bull flag",
  "bear-flag": "Bear flag",
  "channel-up": "Ascending channel",
  "channel-down": "Descending channel",
  range: "Range",
};

interface PatternRow {
  id: string;
  type: string;
  confidence: number;
  dates: string;
  description: string;
}

function day(point: PricePoint | undefined): string {
  const time = point?.date.getTime();
  return time != null && Number.isFinite(time) ? point!.date.toISOString().slice(0, 10) : "—";
}

function rowsFrom(points: PricePoint[], matches: PatternMatch[]): PatternRow[] {
  return matches.map((match, index) => ({
    id: `${match.type}:${match.startIdx}:${match.endIdx}:${index}`,
    type: LABELS[match.type],
    confidence: match.confidence,
    dates: `${day(points[match.startIdx])} – ${day(points[match.endIdx])}`,
    description: match.description,
  }));
}

function sortValue(row: PatternRow, column: string): string | number {
  if (column === "confidence") return row.confidence;
  if (column === "dates") return row.dates;
  if (column === "description") return row.description;
  return row.type;
}

export function PatternsPane({ width, height, focused }: { width: number; height: number; focused: boolean }) {
  const { symbol, equity, history } = usePriceStudyHistory(focused, "patterns");
  const [sort, setSort] = useState({ column: "confidence", direction: "desc" as "asc" | "desc" });
  const rows = useMemo(() => {
    const points = history.data?.history;
    if (!points) return [];
    const sorted = rowsFrom(points, detectPatterns(points, points.length)).sort((left, right) => {
      const order = sortValue(left, sort.column) < sortValue(right, sort.column) ? -1
        : sortValue(left, sort.column) > sortValue(right, sort.column) ? 1 : 0;
      return sort.direction === "asc" ? order : -order;
    });
    return sorted;
  }, [history.data, sort]);

  return (
    <PriceStudyGate
      symbol={symbol}
      equity={equity}
      loading={history.loading}
      error={history.error}
      points={history.data?.history ?? null}
      subject="patterns"
      width={width}
      height={height}
    >
      {() => rows.length === 0 ? <EmptyState title="No patterns in the last year." /> : (
        <DataTableView
          focused={focused}
          columns={COLUMNS}
          items={rows}
          rootWidth={width}
          rootHeight={height}
          getItemKey={(row) => row.id}
          selection={{ kind: "none" }}
          sortColumnId={sort.column}
          sortDirection={sort.direction}
          onHeaderClick={(column) => setSort((current) => current.column === column
            ? { column, direction: current.direction === "desc" ? "asc" : "desc" }
            : { column, direction: "desc" })}
          resetScrollKey={symbol}
          emptyStateTitle="No patterns in the last year."
          renderCell={(row, column): DataTableCell => {
            if (column.id === "confidence") return { text: `${Math.round(row.confidence * 100)}%`, value: row.confidence };
            if (column.id === "dates") return { text: row.dates };
            if (column.id === "description") return { text: row.description };
            return { text: row.type };
          }}
        />
      )}
    </PriceStudyGate>
  );
}
