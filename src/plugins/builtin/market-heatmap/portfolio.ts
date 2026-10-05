import { useEffect, useMemo } from "react";
import type { MarketHeatmapAsset, MarketHeatmapUniverseId } from "../../../api-client/market-discovery";
import { useAppSelector, usePaneStateValue } from "../../../state/app/context";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { selectMarketCapitalization } from "../../../utils/market-capitalization";

export const PORTFOLIO_HEATMAP_TAB = "portfolio";
const MAX_PORTFOLIO_TILES = 160;

export type HeatmapTabId = MarketHeatmapUniverseId | typeof PORTFOLIO_HEATMAP_TAB;

export interface HeatmapBoardAsset extends MarketHeatmapAsset {
  /** False when `size` is only there so the tile is drawn. The caption must not invent a market cap. */
  showSize?: boolean;
  sizeCaption?: "Value";
}

export interface HeatmapPortfolioPane {
  instanceId: string;
  collectionId: string | null;
}

export function heatmapTabId(value: string | null | undefined): HeatmapTabId {
  if (value === "us-equity" || value === "us-etf" || value === PORTFOLIO_HEATMAP_TAB) return value;
  return "us-equity";
}

export function isRemoteHeatmapUniverse(value: HeatmapTabId): value is MarketHeatmapUniverseId {
  return value !== PORTFOLIO_HEATMAP_TAB;
}

/**
 * A linked heatmap changes tab only after the portfolio pane moves from one
 * list to another. The first id, including one that arrives after mount, is
 * the list already selected.
 */
export function heatmapFollowsCollection(
  linked: boolean,
  previous: string | null,
  next: string | null,
): boolean {
  return linked && previous != null && next != null && previous !== next;
}

export function heatmapCollectionLabel(
  config: { portfolios: readonly { id: string; name: string }[]; watchlists: readonly { id: string; name: string }[] },
  collectionId: string | null,
): string {
  if (!collectionId) return "Portfolio";
  return config.portfolios.find((portfolio) => portfolio.id === collectionId)?.name
    ?? config.watchlists.find((watchlist) => watchlist.id === collectionId)?.name
    ?? "Portfolio";
}

export function fallbackHeatmapCollectionId(
  config: { portfolios: readonly { id: string }[]; watchlists: readonly { id: string }[] },
): string | null {
  return config.portfolios[0]?.id ?? config.watchlists[0]?.id ?? null;
}

export function heatmapPortfolioPanes(
  instances: readonly { instanceId: string; paneId: string; params?: Record<string, string> | undefined }[],
  paneState: Record<string, { collectionId?: unknown } | undefined>,
): HeatmapPortfolioPane[] {
  return instances.flatMap((instance) => {
    if (instance.paneId !== "portfolio-list") return [];
    const fromState = paneState[instance.instanceId]?.collectionId;
    const collectionId = typeof fromState === "string" && fromState
      ? fromState
      : instance.params?.collectionId || null;
    return [{ instanceId: instance.instanceId, collectionId }];
  });
}

/** The portfolio pane the user is on, else the one this heatmap last followed. */
export function resolveHeatmapPortfolioSource(
  panes: readonly HeatmapPortfolioPane[],
  focusedPaneId: string | null,
  rememberedSourceId: string | null,
): HeatmapPortfolioPane | null {
  if (panes.length === 0) return null;
  const focused = focusedPaneId ? panes.find((pane) => pane.instanceId === focusedPaneId) : undefined;
  if (focused) return focused;
  const remembered = rememberedSourceId ? panes.find((pane) => pane.instanceId === rememberedSourceId) : undefined;
  return remembered ?? panes[0] ?? null;
}

export function heatmapPortfolioSignature(state: {
  focusedPaneId: string | null;
  config: { layout: { instances: readonly { instanceId: string; paneId: string; params?: Record<string, string> }[] } };
  paneState: Record<string, { collectionId?: unknown } | undefined>;
}): string {
  const panes = heatmapPortfolioPanes(state.config.layout.instances, state.paneState);
  return `${state.focusedPaneId ?? ""}\n${panes.map((pane) => `${pane.instanceId}=${pane.collectionId ?? ""}`).join("\n")}`;
}

export function parseHeatmapPortfolioSignature(signature: string): {
  focusedPaneId: string | null;
  panes: HeatmapPortfolioPane[];
} {
  const [focused = "", ...rows] = signature.split("\n");
  return {
    focusedPaneId: focused || null,
    panes: rows.filter((row) => row.length > 0).map((row) => {
      const splitAt = row.indexOf("=");
      const collectionId = row.slice(splitAt + 1);
      return {
        instanceId: splitAt >= 0 ? row.slice(0, splitAt) : row,
        collectionId: collectionId || null,
      };
    }),
  };
}

export function useLinkedHeatmapCollection(): { collectionId: string | null; sourceInstanceId: string | null } {
  const [remembered, setRemembered] = usePaneStateValue<string>("portfolioSourceId", "");
  const signature = useAppSelector(heatmapPortfolioSignature);
  const resolved = useMemo(() => {
    const { focusedPaneId, panes } = parseHeatmapPortfolioSignature(signature);
    return resolveHeatmapPortfolioSource(panes, focusedPaneId, remembered || null);
  }, [remembered, signature]);

  useEffect(() => {
    const next = resolved?.instanceId ?? "";
    if (next !== remembered) setRemembered(next);
  }, [remembered, resolved, setRemembered]);

  return {
    collectionId: resolved?.collectionId ?? null,
    sourceInstanceId: resolved?.instanceId ?? null,
  };
}

function positionValue(ticker: TickerRecord, collectionId: string, price: number | null): number | null {
  let total = 0;
  let any = false;
  for (const position of ticker.metadata.positions) {
    if (position.portfolio !== collectionId || position.shares === 0) continue;
    if (typeof position.marketValue === "number" && Number.isFinite(position.marketValue) && position.marketValue !== 0) {
      total += Math.abs(position.marketValue);
      any = true;
      continue;
    }
    if (price != null && price > 0) {
      total += Math.abs(position.shares) * price;
      any = true;
    }
  }
  return any && total > 0 ? total : null;
}

export function buildPortfolioHeatmapAssets({
  tickers,
  financials,
  collectionId,
  kind,
}: {
  tickers: readonly TickerRecord[];
  financials: ReadonlyMap<string, TickerFinancials>;
  collectionId: string;
  kind: "portfolio" | "watchlist";
}): HeatmapBoardAsset[] {
  const measured: HeatmapBoardAsset[] = tickers.map((ticker) => {
    const symbol = ticker.metadata.ticker;
    const snapshot = financials.get(symbol);
    const quote = snapshot?.quote;
    const price = quote != null && Number.isFinite(quote.price) ? quote.price : null;
    const cap = selectMarketCapitalization(quote, snapshot?.fundamentals);
    const held = kind === "portfolio" ? positionValue(ticker, collectionId, price) : null;
    const size = held ?? cap?.value ?? null;
    const hasChange = quote != null && Number.isFinite(quote.changePercent);
    return {
      symbol,
      name: quote?.name?.trim() || ticker.metadata.name || symbol,
      price: price ?? 0,
      change: quote != null && Number.isFinite(quote.change) ? quote.change : 0,
      changePercent: hasChange ? quote.changePercent : 0,
      hasChange,
      size,
      sizeKind: "market-cap",
      sizeCaption: held != null ? "Value" : undefined,
      showSize: size != null && size > 0,
      volume: typeof quote?.volume === "number" && Number.isFinite(quote.volume) ? quote.volume : null,
      currency: quote?.currency || cap?.currency || ticker.metadata.currency || "USD",
      exchange: ticker.metadata.exchange || "",
      sector: ticker.metadata.sector ?? null,
      industry: ticker.metadata.industry ?? null,
      marketState: quote?.marketState ?? null,
      source: "gloom",
    };
  });

  measured.sort((left, right) => {
    const leftSize = left.size ?? 0;
    const rightSize = right.size ?? 0;
    if (leftSize === 0 && rightSize === 0) return left.symbol.localeCompare(right.symbol);
    return rightSize - leftSize;
  });
  const kept = measured.slice(0, MAX_PORTFOLIO_TILES);
  const positive = kept.flatMap((asset) => (asset.size != null && asset.size > 0 ? [asset.size] : []));
  const floor = positive.length > 0 ? Math.min(...positive) : 1;
  return kept.map((asset) => {
    const hasSize = asset.size != null && asset.size > 0;
    return hasSize ? asset : { ...asset, size: floor, showSize: false, sizeCaption: undefined };
  });
}
