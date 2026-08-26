import type {
  PredictionBookLevel,
  PredictionMarketDetail,
  PredictionTrade,
} from "../types";

export const POLYMARKET_LIVE_FLUSH_MS = 500;

export interface PendingPredictionLiveUpdates {
  books: Map<
    string,
    {
      bids: PredictionBookLevel[];
      asks: PredictionBookLevel[];
      lastTradePrice: number | null;
    }
  >;
  bbos: Map<
    string,
    {
      bestBid: number | null;
      bestAsk: number | null;
      spread: number | null;
    }
  >;
  trades: Array<{ assetId: string; trade: PredictionTrade }>;
}

export function createPendingPredictionLiveUpdates(): PendingPredictionLiveUpdates {
  return {
    books: new Map(),
    bbos: new Map(),
    trades: [],
  };
}

export function pendingPredictionLiveUpdatesIsEmpty(
  pending: PendingPredictionLiveUpdates,
): boolean {
  return pending.books.size === 0 && pending.bbos.size === 0 && pending.trades.length === 0;
}

export function applyPendingPredictionLiveUpdates(
  detailEntry: PredictionMarketDetail,
  pending: PendingPredictionLiveUpdates,
): PredictionMarketDetail {
  let next = detailEntry;
  for (const [assetId, book] of pending.books) {
    next = applyPredictionBookUpdate(
      next,
      assetId,
      book.bids,
      book.asks,
      book.lastTradePrice,
    );
  }
  for (const [assetId, bbo] of pending.bbos) {
    next = applyPredictionBestBidAskUpdate(
      next,
      assetId,
      bbo.bestBid,
      bbo.bestAsk,
      bbo.spread,
    );
  }
  for (const item of pending.trades) {
    next = applyPredictionTradeUpdate(next, item.assetId, item.trade);
  }
  return next;
}

export function applyPredictionBestBidAskUpdate(
  detailEntry: PredictionMarketDetail,
  assetId: string,
  bestBid: number | null,
  bestAsk: number | null,
  spread: number | null,
): PredictionMarketDetail {
  const isYes = assetId === detailEntry.summary.yesTokenId;
  return {
    ...detailEntry,
    summary: isYes
      ? {
          ...detailEntry.summary,
          yesBid: bestBid,
          yesAsk: bestAsk,
          spread: spread ?? detailEntry.summary.spread,
        }
      : {
          ...detailEntry.summary,
          noBid: bestBid,
          noAsk: bestAsk,
          spread: spread ?? detailEntry.summary.spread,
        },
  };
}

export function applyPredictionBookUpdate(
  detailEntry: PredictionMarketDetail,
  assetId: string,
  bids: PredictionBookLevel[],
  asks: PredictionBookLevel[],
  lastTradePrice: number | null,
): PredictionMarketDetail {
  const isYes = assetId === detailEntry.summary.yesTokenId;
  return {
    ...detailEntry,
    book: isYes
      ? {
          ...detailEntry.book,
          yesBids: bids,
          yesAsks: asks,
          lastTradePrice: lastTradePrice ?? detailEntry.book.lastTradePrice,
        }
      : {
          ...detailEntry.book,
          noBids: bids,
          noAsks: asks,
          lastTradePrice: lastTradePrice ?? detailEntry.book.lastTradePrice,
        },
  };
}

export function applyPredictionTradeUpdate(
  detailEntry: PredictionMarketDetail,
  assetId: string,
  trade: PredictionTrade,
): PredictionMarketDetail {
  const isYes = assetId === detailEntry.summary.yesTokenId;
  const normalizedYesPrice = isYes
    ? trade.price
    : Math.max(0, 1 - trade.price);
  const normalizedTrade: PredictionTrade = {
    ...trade,
    outcome: isYes ? "yes" : "no",
    price: trade.price,
  };
  return {
    ...detailEntry,
    summary: {
      ...detailEntry.summary,
      lastTradePrice: normalizedYesPrice,
      yesPrice: normalizedYesPrice,
      noPrice: Math.max(0, 1 - normalizedYesPrice),
    },
    trades: [
      normalizedTrade,
      ...detailEntry.trades,
    ].slice(0, 40),
  };
}
