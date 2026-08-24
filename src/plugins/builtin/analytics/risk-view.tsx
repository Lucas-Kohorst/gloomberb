import { useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import {
  DataTableView,
  StaticChartSurface,
  type DataTableColumn,
} from "../../../components";
import type { StaticChartSurfaceProps } from "../../../components/chart/static/chart/surface";
import { resolveChartPalette } from "../../../components/chart/core/renderer";
import type { ProjectedChartPoint } from "../../../components/chart/core/data";
import { colors, priceColor } from "../../../theme/colors";
import { formatCompact, formatNumber, formatPercentRaw } from "../../../utils/format";
import {
  buildCumulativeReturnChartPoints,
  computeAnnualizedVolatility,
  computeBetaWeightedMarketExposure,
  computeContributors,
  computeFactorExposure,
  computeVaR,
  splitBestWorst,
  type ContributorInput,
  type FactorReturnSeries,
} from "./risk";
import { formatVaR } from "./pane-model";
import type { DatedReturn } from "./metrics";
import { type SectorTableColumn, type SectorTableRow, buildSectorColumns } from "./sector-model";
import { formatWeight, formatSignedCompact } from "./display";
import {
  applySortPreference,
  CLEARED_SORT,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";

interface RiskViewProps {
  focused: boolean;
  width: number;
  height: number;
  portfolioReturns: number[] | null;
  portfolioReturnSeries: DatedReturn[] | null;
  factors: FactorReturnSeries[];
  marketReturns: DatedReturn[] | null;
  portfolioValue: number;
  contributors: ContributorInput[];
  sectorRows: SectorTableRow[];
  sectorSort: { columnId: SectorTableColumn["id"] | null; direction: "asc" | "desc" };
  onSectorHeaderClick: (columnId: string) => void;
  selectedSectorId: string | null;
  onSelectSector: (sectorId: string) => void;
  resetScrollKey: string;
}

interface FactorRow {
  id: string;
  factor: string;
  beta: number | null;
  exposure: number | null;
}

interface FactorColumn extends DataTableColumn {
  id: "factor" | "beta" | "exposure";
}

function buildFactorColumns(width: number): FactorColumn[] {
  const factorWidth = Math.max(10, Math.min(16, Math.floor(width * 0.22)));
  return [
    { id: "factor", label: "FACTOR", width: factorWidth, align: "left" },
    { id: "beta", label: "BETA", width: 10, align: "right" },
    { id: "exposure", label: "EXPOSURE", width: 14, align: "right" },
  ];
}

interface ContributorRow {
  id: string;
  symbol: string;
  weight: number;
  returnPct: number | null;
  contribution: number | null;
  dollar: number | null;
}

interface ContributorColumn extends DataTableColumn {
  id: "symbol" | "weight" | "return" | "contrib" | "dollar";
}

function buildContributorColumns(width: number): ContributorColumn[] {
  const symbolWidth = Math.max(8, Math.min(14, Math.floor(width * 0.2)));
  return [
    { id: "symbol", label: "SYMBOL", width: symbolWidth, align: "left" },
    { id: "weight", label: "WEIGHT", width: 9, align: "right" },
    { id: "return", label: "RETURN", width: 9, align: "right" },
    { id: "contrib", label: "CONTRIB", width: 10, align: "right" },
    { id: "dollar", label: "$ CONTRIB", width: 12, align: "right" },
  ];
}

function toContributorRows(
  positions: ReturnType<typeof computeContributors>["byPosition"],
): ContributorRow[] {
  return positions.map((entry) => ({
    id: entry.symbol,
    symbol: entry.symbol,
    weight: entry.weight,
    returnPct: entry.returnPct,
    contribution: entry.returnContribution,
    dollar: entry.dollarContribution,
  }));
}

function RiskMetricLine({ label, value, detail, color }: {
  label: string;
  value: string;
  detail?: string;
  color?: string;
}) {
  return (
    <Box flexDirection="row" height={1}>
      <Box width={18} flexShrink={0}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Text fg={color ?? colors.text} attributes={TextAttributes.BOLD}>{value}</Text>
      {detail && <Text fg={colors.textDim}>{`  ${detail}`}</Text>}
    </Box>
  );
}

export function PortfolioRiskView({
  focused,
  width,
  height,
  portfolioReturns,
  portfolioReturnSeries,
  factors,
  marketReturns,
  portfolioValue,
  contributors,
  sectorRows,
  sectorSort,
  onSectorHeaderClick,
  selectedSectorId,
  onSelectSector,
  resetScrollKey,
}: RiskViewProps) {
  const returns = portfolioReturns ?? [];
  const var95 = computeVaR(returns, 0.95, portfolioValue);
  const var99 = computeVaR(returns, 0.99, portfolioValue);
  const volatility = computeAnnualizedVolatility(returns);
  const betaWeightedExposure = computeBetaWeightedMarketExposure(
    portfolioReturnSeries,
    marketReturns,
    portfolioValue,
  );
  const factorExposure = computeFactorExposure(portfolioReturnSeries, factors, portfolioValue);
  const factorRows: FactorRow[] = factorExposure.map((entry) => ({
    id: entry.factor,
    factor: entry.factor,
    beta: entry.beta,
    exposure: entry.exposure,
  }));
  const factorColumns = buildFactorColumns(width);
  const [factorSort, setFactorSort] = useState<SortPreference<FactorColumn["id"]>>({
    columnId: null,
    direction: "desc",
  });
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const sortedFactorRows = useMemo(
    () => applySortPreference(factorRows, factorSort, (row, columnId) => (
      columnId === "factor" ? row.factor : columnId === "beta" ? row.beta : row.exposure
    )),
    [factorRows, factorSort],
  );

  const chartPoints: ProjectedChartPoint[] = portfolioReturnSeries
    ? buildCumulativeReturnChartPoints(portfolioReturnSeries)
    : [];
  const showChart = chartPoints.length >= 2;

  const byReturn = computeContributors(contributors, 5).byReturn;
  const { best: bestContrib, worst: worstContrib } = splitBestWorst(byReturn, 5);
  const largestPositions = computeContributors(contributors, 5).byPosition;
  const contributorColWidth = Math.max(0, Math.floor(width / 2) - 2);
  const contributorColumns = buildContributorColumns(contributorColWidth);
  const bestRows = toContributorRows(bestContrib);
  const worstRows = toContributorRows(worstContrib);
  const largestRows = toContributorRows(largestPositions);

  const sectorColumns = buildSectorColumns(width);

  const chartHeight = showChart ? Math.min(8, Math.max(5, Math.floor(height * 0.22))) : 0;
  const lastCumulative = chartPoints.at(-1)?.close ?? 0;
  const palette: StaticChartSurfaceProps["colors"] = resolveChartPalette(
    colors,
    lastCumulative < 0 ? "negative" : "positive",
  );

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Box height={1}>
          <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>Value at Risk (1-day)</Text>
        </Box>
        <RiskMetricLine
          label="VaR 95% (hist)"
          value={formatVaR(var95.historical)}
          color={colors.negative}
        />
        <RiskMetricLine
          label="VaR 95% (param)"
          value={formatVaR(var95.parametric)}
          color={colors.negative}
        />
        <RiskMetricLine
          label="VaR 99% (hist)"
          value={formatVaR(var99.historical)}
          color={colors.negative}
        />
        <RiskMetricLine
          label="VaR 99% (param)"
          value={formatVaR(var99.parametric)}
          color={colors.negative}
        />
        <Box height={1} />
        <RiskMetricLine
          label="Ann. Volatility"
          value={volatility == null ? "—" : formatPercentRaw(volatility * 100)}
          color={colors.text}
        />
        <RiskMetricLine
          label="Beta-Weighted Mkt"
          value={betaWeightedExposure == null ? "—" : formatCompact(betaWeightedExposure)}
          color={colors.text}
        />
      </Box>

      <Box paddingX={1}>
        <DataTableView<FactorRow, FactorColumn>
          focused={focused}
          columns={factorColumns}
          items={sortedFactorRows}
          selection={{
            kind: "id",
            selectedId: selectedFactorId,
            getId: (row) => row.id,
            onChange: setSelectedFactorId,
          }}
          sortColumnId={factorSort.columnId}
          sortDirection={factorSort.direction}
          onHeaderClick={(columnId) => setFactorSort((current) => nextSortPreference(current, columnId as FactorColumn["id"], { resetTo: CLEARED_SORT }))}
          resetScrollKey={resetScrollKey}
          getItemKey={(row) => row.id}
          emptyStateTitle="No factor data"
          emptyStateHint="Load 1Y price history for factor proxies (SPY, IJR, VTV, MTUM)."
          renderCell={(row, column) => {
            switch (column.id) {
              case "factor":
                return { text: row.factor };
              case "beta":
                return {
                  text: row.beta == null ? "—" : formatNumber(row.beta, 2),
                  color: row.beta == null ? colors.textMuted : priceColor(row.beta),
                };
              case "exposure":
                return {
                  text: row.exposure == null ? "—" : formatSignedCompact(row.exposure),
                  color: row.exposure == null ? colors.textMuted : priceColor(row.exposure),
                };
            }
          }}
        />
      </Box>

      {showChart && (
        <>
          <Box height={1} paddingX={1}>
            <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>
              Cumulative Portfolio Return
            </Text>
          </Box>
          <Box paddingX={1} height={chartHeight}>
            <StaticChartSurface
              points={chartPoints}
              width={Math.max(10, width - 2)}
              height={chartHeight}
              mode="line"
              colors={palette}
              yAxisLabel="Return"
              yAxisColor={colors.textDim}
              formatYAxisValue={(value) => `${(value * 100).toFixed(1)}%`}
            />
          </Box>
        </>
      )}

      <Box paddingX={1} height={Math.min(6, Math.max(3, sectorRows.length + 2))}>
        <DataTableView<SectorTableRow, SectorTableColumn>
          focused={focused}
          selection={{
            kind: "id",
            selectedId: selectedSectorId,
            getId: (row) => row.id,
            onChange: (id) => onSelectSector(id),
          }}
          resetScrollKey={resetScrollKey}
          columns={sectorColumns}
          items={sectorRows}
          sortColumnId={sectorSort.columnId}
          sortDirection={sectorSort.direction}
          onHeaderClick={onSectorHeaderClick}
          getItemKey={(row) => row.id}
          emptyStateTitle="No sector data"
          emptyStateHint="Load profile data or add sectors to the portfolio positions."
          renderCell={(row, column) => {
            switch (column.id) {
              case "sector":
                return { text: row.sector };
              case "weight":
                return { text: formatWeight(row.weight) };
              case "value":
                return { text: formatCompact(row.value) };
              case "pnl":
                return { text: formatSignedCompact(row.pnl), color: priceColor(row.pnl) };
              case "return":
                return {
                  text: row.returnPct == null ? "—" : formatPercentRaw(row.returnPct),
                  color: row.returnPct == null ? colors.textMuted : priceColor(row.returnPct),
                };
              case "bar":
                return { text: "", color: colors.textMuted };
            }
          }}
        />
      </Box>

      <Box height={1} paddingX={1}>
        <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>Contributors</Text>
      </Box>
      <Box flexDirection="row" paddingX={1} flexShrink={1}>
        <Box flexDirection="column" width={contributorColWidth} flexShrink={1}>
          <Box height={1}>
            <Text fg={colors.positive}>Top by return</Text>
          </Box>
          <ContributorTable
            focused={focused}
            columns={contributorColumns}
            rows={bestRows}
            resetScrollKey={`${resetScrollKey}-best`}
          />
        </Box>
        <Box width={2} flexShrink={0} />
        <Box flexDirection="column" width={contributorColWidth} flexShrink={1}>
          <Box height={1}>
            <Text fg={colors.negative}>Worst by return</Text>
          </Box>
          <ContributorTable
            focused={focused}
            columns={contributorColumns}
            rows={worstRows}
            resetScrollKey={`${resetScrollKey}-worst`}
          />
        </Box>
      </Box>
      <Box flexDirection="row" paddingX={1} flexShrink={1}>
        <Box flexDirection="column" width={contributorColWidth} flexShrink={1}>
          <Box height={1}>
            <Text fg={colors.textDim}>Largest positions</Text>
          </Box>
          <ContributorTable
            focused={focused}
            columns={contributorColumns}
            rows={largestRows}
            resetScrollKey={`${resetScrollKey}-largest`}
          />
        </Box>
      </Box>
    </Box>
  );
}

function ContributorTable({
  focused,
  columns,
  rows,
  resetScrollKey,
}: {
  focused: boolean;
  columns: ContributorColumn[];
  rows: ContributorRow[];
  resetScrollKey: string;
}) {
  const [sort, setSort] = useState<SortPreference<ContributorColumn["id"]>>({
    columnId: null,
    direction: "desc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sortedRows = useMemo(
    () => applySortPreference(rows, sort, (row, columnId) => {
      switch (columnId) {
        case "symbol": return row.symbol;
        case "weight": return row.weight;
        case "return": return row.returnPct;
        case "contrib": return row.contribution;
        case "dollar": return row.dollar;
      }
    }),
    [rows, sort],
  );

  return (
    <DataTableView<ContributorRow, ContributorColumn>
      focused={focused}
      columns={columns}
      items={sortedRows}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: setSelectedId,
      }}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => nextSortPreference(current, columnId as ContributorColumn["id"], { resetTo: CLEARED_SORT }))}
      resetScrollKey={resetScrollKey}
      getItemKey={(row) => row.id}
      emptyStateTitle="No contributors"
      emptyStateHint="Load position price history."
      renderCell={(row, column) => {
        switch (column.id) {
          case "symbol":
            return { text: row.symbol };
          case "weight":
            return { text: formatWeight(row.weight) };
          case "return":
            return {
              text: row.returnPct == null ? "—" : formatPercentRaw(row.returnPct * 100),
              color: row.returnPct == null ? colors.textMuted : priceColor(row.returnPct),
            };
          case "contrib":
            return {
              text: row.contribution == null ? "—" : formatPercentRaw(row.contribution * 100),
              color: row.contribution == null ? colors.textMuted : priceColor(row.contribution),
            };
          case "dollar":
            return {
              text: row.dollar == null ? "—" : formatSignedCompact(row.dollar),
              color: row.dollar == null ? colors.textMuted : priceColor(row.dollar),
            };
        }
      }}
    />
  );
}
