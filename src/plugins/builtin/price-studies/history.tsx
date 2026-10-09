import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { EmptyState, PaneStatusBody, loadingErrorFooterInfo, usePaneFooter } from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useAsyncResource } from "../../../react/async-resource";
import { resolveTickerInstrumentKind } from "../../../tickers/instrument-kind";
import type { PricePoint } from "../../../types/financials";
import { useBoundTicker } from "../shared/ticker-request";
import { loadPriceStudyHistory } from "./client";

export function usePriceStudyHistory(focused: boolean, paneId: string) {
  const { symbol, ticker } = useBoundTicker();
  const equity = resolveTickerInstrumentKind(ticker) === "equity";
  const instrument = equity ? instrumentFromTicker(ticker, symbol) : null;
  const instrumentKey = JSON.stringify(instrument);
  const controller = useRef<AbortController | null>(null);
  const instrumentRef = useRef(instrument);
  instrumentRef.current = instrument;
  const loader = useCallback(async (force: boolean) => {
    const current = instrumentRef.current;
    if (!current) throw new Error("Daily price history unavailable");
    controller.current?.abort();
    controller.current = new AbortController();
    const snapshot = await loadPriceStudyHistory({
      instrument: current,
      forceRefresh: force,
      signal: controller.current.signal,
    });
    if (!snapshot.history.length && snapshot.error) throw new Error(snapshot.error);
    return snapshot;
  }, [instrumentKey]);
  const history = useAsyncResource(instrument ? loader : null);
  useEffect(() => () => controller.current?.abort(), [loader]);
  usePaneRefreshKey(() => { void history.reload(); }, { focused, enabled: !!instrument });
  usePaneFooter(paneId, () => ({
    info: loadingErrorFooterInfo(history.loading, history.error),
  }), [history.loading, history.error]);
  return { symbol, equity, history };
}

export function PriceStudyGate({
  symbol,
  equity,
  loading,
  error,
  points,
  subject,
  width,
  height,
  children,
}: {
  symbol: string | null;
  equity: boolean;
  loading: boolean;
  error: string | null;
  points: PricePoint[] | null;
  subject: string;
  width: number;
  height: number;
  children: (points: PricePoint[]) => ReactNode;
}) {
  if (!symbol) return <EmptyState title="Select a ticker." />;
  if (!equity) return <EmptyState title="Equity listings only." />;
  return (
    <PaneStatusBody
      width={width}
      height={height}
      subject={subject}
      loading={loading && !points}
      error={!points ? error : null}
    >
      {points ? children(points) : null}
    </PaneStatusBody>
  );
}
