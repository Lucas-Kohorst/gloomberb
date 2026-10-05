import type { ChartSeriesSource } from "../../../time-series/types";
import type { ChartResolveSources } from "../../../time-series/resolve";
import { createSpecLibraryFeed, feedTickerForSource, librarySafeTicker, type LibraryDatafeed, type LibrarySearchItem } from "./charting-library-feed";

export interface LibraryInstrument extends LibrarySearchItem {
  source: ChartSeriesSource;
}

/** Route both replacement and Compare through the same source directory. */
export function createSearchableLibraryFeed(options: {
  base: LibraryDatafeed;
  getSources: () => ChartResolveSources;
  search: (query: string, signal: AbortSignal) => Promise<LibraryInstrument[]>;
  read: (ticker: string) => LibraryInstrument | null;
  remember: (instrument: LibraryInstrument) => void;
}): { feed: LibraryDatafeed; dispose: () => void } {
  const instruments = new Map<string, LibraryInstrument>();
  const directory = new Map<string, ChartSeriesSource>();
  const subscriptions = new Map<string, LibraryDatafeed>();
  const dynamic = createSpecLibraryFeed({ getSources: options.getSources, getDirectory: () => directory }).feed;
  let pending: AbortController | undefined;
  let stopPublishSubscription: (() => void) | undefined;
  const publish = (symbol: string, bar: Parameters<NonNullable<LibraryDatafeed["publish"]>>[1], resolution?: string) => {
    const ticker = symbol.trim().toUpperCase();
    const instrument = find(ticker);
    if (instrument) dynamic.publish?.(ticker, bar, resolution);
    else if (options.base.getSourceForSymbol?.(ticker)) options.base.publish?.(ticker, bar, resolution);
  };
  const dispose = () => {
    pending?.abort();
    for (const [id, subscribedFeed] of subscriptions) subscribedFeed.unsubscribeBars(id);
    subscriptions.clear();
    stopPublishSubscription?.();
    stopPublishSubscription = undefined;
  };
  const find = (symbol: string): LibraryInstrument | null => {
    const ticker = symbol.trim().toUpperCase();
    const instrument = instruments.get(ticker) ?? options.read(ticker);
    if (instrument) {
      instruments.set(ticker, instrument);
      directory.set(ticker, instrument.source);
    }
    return instrument;
  };
  const route = (symbol: string | undefined) => symbol && find(symbol) ? dynamic : options.base;
  const feed: LibraryDatafeed = {
      onReady: (callback) => options.base.onReady(callback),
      searchSymbols(query, exchange, type, onResult) {
        pending?.abort();
        const controller = new AbortController();
        pending = controller;
        const local = new Promise<LibrarySearchItem[]>((resolve) => options.base.searchSymbols(query, exchange, type, resolve));
        void Promise.allSettled([local, options.search(query, controller.signal)]).then(([base, found]) => {
          if (controller.signal.aborted) return;
          const matches = found.status === "fulfilled" ? found.value : [];
          for (const item of matches) {
            instruments.set(item.ticker.toUpperCase(), item);
            directory.set(item.ticker.toUpperCase(), item.source);
          }
          const rows = [...matches, ...(base.status === "fulfilled" ? base.value : [])];
          const seen = new Set<string>();
          onResult(rows.filter((row) => {
            if (exchange && row.exchange.toUpperCase() !== exchange.toUpperCase()) return false;
            if (type && row.type !== type) return false;
            if (seen.has(row.ticker)) return false;
            seen.add(row.ticker);
            return true;
          }).slice(0, 50).map(({ symbol, description, exchange, ticker, type }) => ({ symbol, description, exchange, ticker, type })));
        });
      },
      resolveSymbol(symbol, resolve, reject, extension) {
        const instrument = find(symbol);
        const feed = instrument ? dynamic : options.base;
        feed.resolveSymbol(symbol, (info) => {
          if (instrument) {
            options.remember(instrument);
            resolve({ ...info, ticker: instrument.ticker, name: instrument.symbol, description: instrument.description, long_description: instrument.description, type: instrument.type });
          } else resolve(info);
        }, reject, extension);
      },
      getBars(info, resolution, period, resolve, reject) {
        route(info.ticker ?? info.name).getBars(info, resolution, period, resolve, reject);
      },
      subscribeBars(info, resolution, tick, id, reset) {
        const feed = route(info.ticker ?? info.name);
        subscriptions.get(id)?.unsubscribeBars(id);
        subscriptions.set(id, feed);
        feed.subscribeBars(info, resolution, tick, id, reset);
      },
      unsubscribeBars(id) {
        subscriptions.get(id)?.unsubscribeBars(id);
        subscriptions.delete(id);
      },
      publish,
      getSourceForSymbol(symbol) {
        return find(symbol)?.source ?? options.base.getSourceForSymbol?.(symbol) ?? null;
      },
      subscribePublish(listener) {
        const stopDynamic = dynamic.subscribePublish?.(listener);
        const stopBase = options.base.subscribePublish?.((symbol, bar, resolution) => {
          if (!find(symbol)) listener(symbol, bar, resolution);
        });
        return () => {
          stopDynamic?.();
          stopBase?.();
        };
      },
    };
  stopPublishSubscription = options.base.subscribePublish?.((symbol, bar, resolution) => {
    const ticker = symbol.trim().toUpperCase();
    if (find(ticker)) dynamic.publish?.(ticker, bar, resolution);
  });
  return { feed, dispose };
}

export function libraryInstrument(source: ChartSeriesSource, description: string, type: string): LibraryInstrument | null {
  const baseTicker = feedTickerForSource(source);
  if (!baseTicker) return null;
  const ticker = source.kind === "security" && source.fieldId !== "market.ohlcv" && source.fieldId !== "market.close"
    ? `${baseTicker}_${librarySafeTicker(source.fieldId)}` : baseTicker;
  const colon = ticker.indexOf(":");
  return { ticker, symbol: colon < 0 ? ticker : ticker.slice(colon + 1), description, exchange: colon < 0 ? "" : ticker.slice(0, colon), type, source };
}
