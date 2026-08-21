import { canonicalCryptoInstrument, COINGECKO_EXCHANGE, isCryptoSearchType } from "../../sources/coingecko/ids";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { TickerRecord, TickerMetadata } from "../../types/ticker";
import type { AppTickerRepositoryPort } from "../../core/app-service-ports";
import {
  classifyInstrumentKind,
} from "./ranking";
import {
  getSearchResultSymbol,
  shouldReplaceTickerName,
} from "./result";

function cryptoMetadataFromSearchResult(result: InstrumentSearchResult): { symbol: string; exchange: string } | null {
  const hint = isCryptoSearchType(result.type) || isCryptoSearchType(result.brokerContract?.secType)
    ? COINGECKO_EXCHANGE
    : result.exchange;
  return canonicalCryptoInstrument(result.brokerContract?.localSymbol || result.symbol, hint);
}

export async function upsertTickerFromSearchResult(
  tickerRepository: AppTickerRepositoryPort,
  result: InstrumentSearchResult,
): Promise<{ ticker: TickerRecord; created: boolean }> {
  const canonical = cryptoMetadataFromSearchResult(result);
  const symbol = canonical?.symbol ?? getSearchResultSymbol(result);
  const exchange = canonical?.exchange ?? result.exchange;
  let ticker = await tickerRepository.loadTicker(symbol);
  const created = !ticker;

  if (!ticker) {
    const metadata: TickerMetadata = {
      ticker: symbol,
      exchange,
      currency: result.currency || result.brokerContract?.currency || "USD",
      name: result.name || symbol,
      assetCategory: canonical ? "CRYPTO" : (result.brokerContract?.secType || result.type || undefined),
      broker_contracts: result.brokerContract ? [result.brokerContract] : [],
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    };
    ticker = await tickerRepository.createTicker(metadata);
  } else {
    const changed = mergeTickerMetadataFromSearchResult(ticker.metadata, result, canonical);
    const existingContracts = ticker.metadata.broker_contracts ?? [];
    if (result.brokerContract) {
      const nextContracts = [...existingContracts];
      const hasContract = nextContracts.some((contract) =>
        contract.brokerId === result.brokerContract!.brokerId
        && contract.brokerInstanceId === result.brokerContract!.brokerInstanceId
        && contract.conId === result.brokerContract!.conId
        && contract.localSymbol === result.brokerContract!.localSymbol
      );
      if (!hasContract) {
        nextContracts.push(result.brokerContract);
        ticker.metadata.broker_contracts = nextContracts;
      }
    }
    if (changed || ticker.metadata.broker_contracts !== existingContracts) {
      await tickerRepository.saveTicker(ticker);
    }
  }

  return { ticker, created };
}

function mergeTickerMetadataFromSearchResult(
  metadata: TickerMetadata,
  result: InstrumentSearchResult,
  canonical: { symbol: string; exchange: string } | null,
): boolean {
  let changed = false;
  const nextName = result.name?.trim();
  const nextExchange = (canonical?.exchange || result.exchange)?.trim();
  const nextCurrency = (result.currency || result.brokerContract?.currency || "").trim();
  const nextAssetCategory = canonical
    ? "CRYPTO"
    : (result.brokerContract?.secType || result.type || "").trim();

  if (nextName && shouldReplaceTickerName(metadata.name, metadata.ticker, nextName)) {
    metadata.name = nextName;
    changed = true;
  }
  if (nextExchange && (!metadata.exchange || (canonical && metadata.exchange !== canonical.exchange))) {
    metadata.exchange = nextExchange;
    changed = true;
  }
  if (nextCurrency && !metadata.currency) {
    metadata.currency = nextCurrency;
    changed = true;
  }
  if (nextAssetCategory && shouldReplaceAssetCategory(metadata.assetCategory, nextAssetCategory)) {
    metadata.assetCategory = nextAssetCategory;
    changed = true;
  }

  return changed;
}

function shouldReplaceAssetCategory(currentCategory: string | undefined, nextCategory: string): boolean {
  if (!currentCategory?.trim()) return true;
  const currentClass = classifyInstrumentKind(currentCategory);
  const nextClass = classifyInstrumentKind(nextCategory);
  return currentClass === "equity" && nextClass !== "equity";
}
