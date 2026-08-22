import { useCallback, useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import { DataTableView, EmptyState, usePaneFooter, type DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { usePluginAppActions } from "../../runtime";
import type { PredictionMarketSummary } from "../types";
import {
  matchSettlementSeries,
  type SettlementSeriesMatch,
} from "./settlement-match";

type DataColumnId = "source" | "series" | "expression";
type DataColumn = DataTableColumn & { id: DataColumnId };

const DATA_COLUMNS: DataColumn[] = [
  { id: "source", label: "SRC", width: 10, align: "left" },
  { id: "series", label: "SERIES", width: 28, align: "left" },
  { id: "expression", label: "G", width: 18, align: "left" },
];

export function PredictionMarketDataTab({
  focused,
  summary,
  width,
}: {
  focused: boolean;
  summary: PredictionMarketSummary;
  width: number;
}) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const match = useMemo(() => matchSettlementSeries(summary), [summary]);
  const [sortColumnId, setSortColumnId] = useState<DataColumnId>("series");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedId, setSelectedId] = useState<string | null>(
    match.series[0]?.id ?? null,
  );

  const rows = useMemo(() => {
    const sorted = [...match.series];
    sorted.sort((left, right) => {
      const a = sortColumnId === "source"
        ? left.source
        : sortColumnId === "expression"
          ? left.expression
          : left.label;
      const b = sortColumnId === "source"
        ? right.source
        : sortColumnId === "expression"
          ? right.expression
          : right.label;
      const cmp = a.localeCompare(b);
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [match.series, sortColumnId, sortDirection]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const graphSeries = useCallback((row: SettlementSeriesMatch | null) => {
    if (!row) return;
    createPaneFromTemplate("chart-composer-pane", { arg: row.expression });
  }, [createPaneFromTemplate]);

  useShortcut((event) => {
    if (!focused || event.defaultPrevented || event.propagationStopped) return;
    const key = (event.name ?? event.sequence ?? "").toLowerCase();
    if (key !== "g") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    graphSeries(selected);
  }, { enabled: focused && !!selected });

  usePaneFooter("prediction-markets-data", () => {
    if (match.series.length === 0) return null;
    return {
      hints: [
        {
          id: "graph",
          key: "g",
          label: "raph",
          onPress: () => graphSeries(selected),
          disabled: !selected,
        },
      ],
    };
  }, [match.series.length, selected]);

  if (match.series.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" paddingX={1}>
        <EmptyState
          title="No matching settlement series."
          hint={
            match.sourceSnippet
              ? match.sourceSnippet
              : "Could not map rules / underlying / ticker to CAT, FRED, Yahoo, weather, crypto, or polls."
          }
        />
      </Box>
    );
  }

  const sourceWidth = Math.max(12, width - 2);

  return (
    <Box flexGrow={1} flexDirection="column">
      {match.sourceLabel && (
        <Box paddingX={1} paddingBottom={1}>
          <Text fg={colors.textBright} width={sourceWidth} wrapMode="ellipsis">
            Settles to: {match.sourceLabel}
          </Text>
          {selected ? (
            <Text fg={colors.textDim} width={sourceWidth} wrapMode="ellipsis">
              {selected.reason}
            </Text>
          ) : null}
        </Box>
      )}
      <Box paddingX={1} paddingBottom={1}>
        <Text fg={colors.textDim} width={sourceWidth} wrapMode="ellipsis">
          Suggested data feeds
        </Text>
      </Box>
      <DataTableView<SettlementSeriesMatch, DataColumn>
        focused={focused}
        keyboardNavigation={focused}
        rootWidth={width}
        rootBackgroundColor={colors.panel}
        selection={{
          kind: "id",
          selectedId: selected?.id ?? null,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onActivate={(row) => graphSeries(row)}
        columns={DATA_COLUMNS}
        items={rows}
        sortColumnId={sortColumnId}
        sortDirection={sortDirection}
        onHeaderClick={(columnId) => {
          const next = columnId as DataColumnId;
          if (next === sortColumnId) {
            setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
          } else {
            setSortColumnId(next);
            setSortDirection("asc");
          }
        }}
        getItemKey={(row) => row.id}
        renderCell={(row, column) => {
          switch (column.id) {
            case "source":
              return { text: row.source, color: colors.textDim };
            case "expression":
              return { text: row.expression, color: colors.textBright };
            case "series":
            default:
              return { text: row.label, color: colors.text };
          }
        }}
        emptyStateTitle="No matching settlement series."
      />
    </Box>
  );
}
