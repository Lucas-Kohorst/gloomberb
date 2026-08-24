import { useCallback, useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import { DataTableView, EmptyState, usePaneFooter, type DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { usePluginAppActions } from "../../runtime";
import type { PredictionMarketSummary } from "../types";
import {
  matchSettlementSeries,
  type SettlementMatchRank,
  type SettlementSeriesMatch,
} from "./settlement-match";

type DataColumnId = "source" | "series" | "expression" | "reason";
type DataColumn = DataTableColumn & { id: DataColumnId };

const DATA_COLUMNS: DataColumn[] = [
  { id: "source", label: "SRC", width: 10, align: "left" },
  { id: "series", label: "SERIES", width: 22, align: "left" },
  { id: "expression", label: "G", width: 16, align: "left" },
  { id: "reason", label: "WHY", width: 8, align: "left" },
];

const RANK_ORDER: Record<SettlementMatchRank, number> = {
  rules: 0,
  map: 1,
  ticker: 2,
  alias: 3,
};

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
  const [sortColumnId, setSortColumnId] = useState<DataColumnId>("reason");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedId, setSelectedId] = useState<string | null>(
    match.series[0]?.id ?? null,
  );

  const rows = useMemo(() => {
    const sorted = [...match.series];
    sorted.sort((left, right) => {
      let cmp = 0;
      if (sortColumnId === "source") cmp = left.source.localeCompare(right.source);
      else if (sortColumnId === "expression") cmp = left.expression.localeCompare(right.expression);
      else if (sortColumnId === "reason") cmp = RANK_ORDER[left.reason] - RANK_ORDER[right.reason];
      else cmp = left.label.localeCompare(right.label);
      if (cmp === 0) cmp = RANK_ORDER[left.reason] - RANK_ORDER[right.reason];
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [match.series, sortColumnId, sortDirection]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const settlesTo = match.sourceLabel ?? match.sourceSnippet;
  const sourceWidth = Math.max(12, width - 2);

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

  return (
    <Box flexGrow={1} flexDirection="column">
      {settlesTo ? (
        <Box paddingX={1} paddingBottom={1}>
          <Text fg={colors.textBright} width={sourceWidth} wrapMode="ellipsis">
            Settles to: {settlesTo}
          </Text>
          {match.sourceSnippet && match.sourceSnippet !== settlesTo ? (
            <Text fg={colors.textDim} width={sourceWidth} wrapMode="ellipsis">
              {match.sourceSnippet}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Box paddingX={1} paddingBottom={1}>
        <Text fg={colors.textDim} width={sourceWidth} wrapMode="ellipsis">
          Suggested data feeds
        </Text>
      </Box>
      {rows.length === 0 ? (
        <Box flexGrow={1} justifyContent="center" paddingX={1}>
          <EmptyState
            title="No matching settlement series."
            hint="Could not map rules / underlying / ticker to CAT, FRED, Yahoo, weather, crypto, or polls."
          />
        </Box>
      ) : (
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
              case "reason":
                return { text: row.reason, color: colors.textDim };
              case "series":
              default:
                return { text: row.label, color: colors.text };
            }
          }}
          emptyStateTitle="No matching settlement series."
        />
      )}
    </Box>
  );
}
