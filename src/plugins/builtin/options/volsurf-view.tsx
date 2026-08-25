import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text } from "../../../ui";
import { usePaneTicker } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import { formatExpDate, resolveOptionsTarget } from "../../../utils/options";
import {
  useOptionsQuery,
  useResolvedEntryValue,
} from "../../../market-data/hooks";
import type { OptionsRequest } from "../../../market-data/request-types";
import {
  DataTableView,
  EmptyState,
  LoadingState,
  TickerEmptyState,
  Spinner,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { isPlainKey } from "../../../utils/keyboard";
import {
  applySortPreference,
  nextSortPreference,
  type SortPreference,
} from "../../../utils/sort-values";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { useLiveStreamingSetting } from "../shared/live-streaming";
import type { OptionsChain } from "../../../types/financials";
import {
  computeVolSurface,
  formatIvCell,
  volSurfaceCellBackground,
  volSurfaceCellText,
  type VolSurface,
} from "./volsurf";

/** Cap the surface width so the heatmap stays legible in a floating pane. */
export const MAX_SURF_EXPIRATIONS = 8;
export const OPTIONS_VOL_SURFACE_PANE_ID = "options-vol-surface";

export type VolSurfaceViewProps = {
  width: number;
  height: number;
  focused: boolean;
  onCapture?: (capturing: boolean) => void;
};

interface VolSurfaceRow {
  strike: number;
  cells: (VolSurface["cells"][number][number])[];
}

/**
 * Fetch a single expiration's chain and report resolved data up. Rendered as a
 * null child so the parent can own the heatmap layout while still leveraging the
 * shared reactive options query hook per expiration.
 */
function ExpirationFetcher({
  request,
  onChain,
}: {
  request: OptionsRequest | null;
  onChain: (expiration: number | null, chain: OptionsChain | null) => void;
}) {
  const entry = useOptionsQuery(request);
  const chain = useResolvedEntryValue(entry);
  const expiration = request?.expirationDate ?? null;
  useEffect(() => {
    onChain(expiration, chain);
  }, [chain, expiration, onChain]);
  return null;
}

export function VolSurfaceView({ width, height, focused }: VolSurfaceViewProps) {
  const { ticker, financials } = usePaneTicker();
  useLiveStreamingSetting();
  const target = resolveOptionsTarget(ticker);
  const instrument = target?.instrument ?? null;
  const effectiveTicker = target?.effectiveTicker ?? "";
  const effectiveExchange = target?.effectiveExchange ?? "";

  const baseRequest = useMemo<OptionsRequest | null>(() => {
    if (!target) return null;
    return {
      instrument: {
        symbol: effectiveTicker,
        exchange: effectiveExchange,
        brokerId: instrument?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId,
        instrument,
      },
    };
  }, [effectiveExchange, effectiveTicker, instrument, target]);

  const baseChainEntry = useOptionsQuery(baseRequest);
  const baseChain = useResolvedEntryValue(baseChainEntry);
  const loadingBase = (baseChainEntry?.phase === "loading" || baseChainEntry?.phase === "refreshing") && !baseChain;
  const errorBase = baseChainEntry?.phase === "error"
    ? baseChainEntry.error?.message ?? "Failed to load options"
    : null;

  const expirationDates = baseChain?.expirationDates ?? [];
  const limitedExpirations = useMemo(
    () => expirationDates.slice(0, MAX_SURF_EXPIRATIONS),
    [expirationDates],
  );

  // Parent-owned aggregation of per-expiration chains.
  const [chainsByExpiration, setChainsByExpiration] = useState<Map<number, OptionsChain>>(
    () => new Map(),
  );
  // Reset the aggregated surface when the underlying changes.
  useEffect(() => {
    setChainsByExpiration(new Map());
  }, [effectiveTicker, effectiveExchange]);

  const handleChain = useCallback((expiration: number | null, chain: OptionsChain | null) => {
    setChainsByExpiration((current) => {
      if (expiration == null) return current;
      const existing = current.get(expiration);
      if (existing === chain) return current;
      const next = new Map(current);
      if (chain) next.set(expiration, chain);
      else next.delete(expiration);
      return next;
    });
  }, []);

  const spot = financials?.quote?.price ?? null;
  const dividendYield = financials?.fundamentals?.dividendYield ?? null;

  const surface = useMemo(
    () => computeVolSurface(chainsByExpiration, { spot, dividendYield }),
    [chainsByExpiration, dividendYield, spot],
  );

  const anyLoading = loadingBase
    || (limitedExpirations.length > 0 && chainsByExpiration.size < limitedExpirations.length);

  // Heatmap table: rows = strikes, columns = expirations.
  const columns = useMemo<DataTableColumn[]>(() => {
    const cols: DataTableColumn[] = [
      { id: "strike", label: "STRIKE", width: 9, align: "right" },
    ];
    for (const expiration of surface.expirations) {
      cols.push({
        id: String(expiration),
        label: formatExpDate(expiration),
        width: 7,
        align: "right",
      });
    }
    return cols;
  }, [surface.expirations]);

  const [sortPreference, setSortPreference] = useState<SortPreference>({
    columnId: null,
    direction: "asc",
  });
  const rows = useMemo<VolSurfaceRow[]>(() => {
    const expirations = surface.expirations;
    const unordered = surface.strikes.map((strike, strikeIndex) => ({
      strike,
      cells: expirations.map((_expiration, expIndex) => surface.cells[strikeIndex]?.[expIndex] ?? null),
    }));
    return applySortPreference(unordered, sortPreference, (row, columnId) => {
      if (columnId === "strike") return row.strike;
      const expIndex = expirations.indexOf(Number(columnId));
      return row.cells[expIndex]?.impliedVolatility ?? null;
    });
  }, [sortPreference, surface]);

  const [selectedStrike, setSelectedStrike] = useState(0);
  useEffect(() => {
    setSelectedStrike((index) => Math.min(index, Math.max(0, surface.strikes.length - 1)));
  }, [surface.strikes.length]);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "j", "down")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedStrike((i) => Math.min(i + 1, surface.strikes.length - 1));
      return true;
    }
    if (isPlainKey(event, "k", "up")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedStrike((i) => Math.max(i - 1, 0));
      return true;
    }
    return false;
  }, [surface.strikes.length]);

  const renderCell = useCallback(
    (row: VolSurfaceRow, column: DataTableColumn): DataTableCell => {
      if (column.id === "strike") {
        return {
          text: row.strike % 1 === 0 ? String(row.strike) : row.strike.toFixed(1),
          color: colors.textDim,
        };
      }
      const expIndex = surface.expirations.indexOf(Number(column.id));
      const cell = row.cells[expIndex] ?? null;
      if (!cell) return { text: "—", color: colors.textDim };
      return {
        text: formatIvCell(cell.impliedVolatility),
        color: volSurfaceCellText(cell.impliedVolatility, surface.minIv, surface.maxIv),
        backgroundColor: volSurfaceCellBackground(cell.impliedVolatility, surface.minIv, surface.maxIv),
      };
    },
    [surface.expirations, surface.minIv, surface.maxIv],
  );

  usePaneStatusFooter({
    registrationId: OPTIONS_VOL_SURFACE_PANE_ID,
    loading: anyLoading,
    error: errorBase,
    focused,
    info: surface.minIv != null && surface.maxIv != null
      ? [{
        id: "iv-range",
        parts: [{
          text: `IV ${(surface.minIv * 100).toFixed(1)}–${(surface.maxIv * 100).toFixed(1)}%`,
          tone: "muted",
        }],
      }]
      : [],
  });

  if (!ticker) return <TickerEmptyState kind="options" symbol={null} detail="listed options" />;
  if (loadingBase && !baseChain) return <LoadingState title="Loading options chain..." />;
  if (errorBase && !baseChain) {
    return (
      <TickerEmptyState
        kind="options"
        symbol={effectiveTicker || ticker.metadata.ticker}
        detail="listed options"
        error={errorBase}
      />
    );
  }
  if (!baseChain || baseChain.expirationDates.length === 0) {
    return (
      <TickerEmptyState
        kind="options"
        symbol={effectiveTicker || ticker.metadata.ticker}
        detail="listed options"
      />
    );
  }

  const tableWidth = 9 + surface.expirations.length * 7;
  const tooNarrow = width < tableWidth + 4;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box flexDirection="row" height={1} gap={1}>
        <Text fg={colors.textDim}>Vol surface</Text>
        <Text fg={colors.text}>{effectiveTicker}</Text>
        {spot != null && <Text fg={colors.textDim}>@ ${spot.toFixed(2)}</Text>}
        {anyLoading && <Spinner />}
      </Box>

      {tooNarrow ? (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text fg={colors.textDim}>Widen the pane to view the surface.</Text>
        </Box>
      ) : surface.strikes.length === 0 ? (
        <EmptyState fill={false} title="No marketable option prices to solve." />
      ) : (
        <DataTableView<VolSurfaceRow, DataTableColumn>
          focused={focused}
          selection={{
            kind: "index",
            selectedIndex: selectedStrike,
            onChange: setSelectedStrike,
          }}
          onRootKeyDown={handleTableKeyDown}
          headerScrollId="volsurf-table-header-scroll"
          bodyScrollId="volsurf-table-body-scroll"
          columns={columns}
          items={rows}
          sortColumnId={sortPreference.columnId}
          sortDirection={sortPreference.direction}
          onHeaderClick={(columnId) => setSortPreference((current) => nextSortPreference(current, columnId))}
          getItemKey={(row) => String(row.strike)}
          renderCell={renderCell}
          emptyStateTitle="No options data"
          emptyStateMessage="No strikes for this expiration."
          columnGap={0}
          horizontalPadding={0}
          fillAvailableWidth={false}
          scrollToIndex={selectedStrike}
          scrollToIndexAlign="nearest"
        />
      )}

      {/* Hidden per-expiration fetchers keep reactive cache entries alive. */}
      {Array.from({ length: MAX_SURF_EXPIRATIONS }, (_, index) => {
        const expiration = limitedExpirations[index];
        const request = baseRequest && expiration != null
          ? { ...baseRequest, expirationDate: expiration }
          : null;
        return (
          <ExpirationFetcher
            key={index}
            request={request}
            onChain={handleChain}
          />
        );
      })}
    </Box>
  );
}
