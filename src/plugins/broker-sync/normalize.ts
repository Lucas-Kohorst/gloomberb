import type { BrokerPosition } from "../../types/broker";
import type { BrokerAccount } from "../../types/trading";

export interface BrokerPortfolioSnapshot {
  accounts: BrokerAccount[];
  positions: BrokerPosition[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replaceAll(",", ""))
        : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nested(source: UnknownRecord, key: string): UnknownRecord {
  return record(source[key]) ?? {};
}

function allRecords(value: unknown, output: UnknownRecord[] = [], seen = new Set<object>()): UnknownRecord[] {
  if (value === null || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) allRecords(item, output, seen);
    return output;
  }
  const item = value as UnknownRecord;
  output.push(item);
  for (const child of Object.values(item)) allRecords(child, output, seen);
  return output;
}

function accountId(source: UnknownRecord): string {
  return text(
    source.accountId,
    source.account_id,
    source.accountNumber,
    source.account_number,
    source.brokerageAccountId,
    source.brokerage_account_id,
  );
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[_\s-])([a-z])/g, (_match, prefix: string, letter: string) => (
    `${prefix === "_" ? " " : prefix}${letter.toUpperCase()}`
  ));
}

function uniqueSnapshot(accounts: BrokerAccount[], positions: BrokerPosition[]): BrokerPortfolioSnapshot {
  const uniqueAccounts = [...new Map(accounts.map((account) => [account.accountId, account])).values()];
  const knownAccounts = new Set(uniqueAccounts.map((account) => account.accountId));
  for (const position of positions) {
    if (!position.accountId || knownAccounts.has(position.accountId)) continue;
    knownAccounts.add(position.accountId);
    uniqueAccounts.push({
      accountId: position.accountId,
      name: position.accountId,
      currency: position.currency,
    });
  }
  return { accounts: uniqueAccounts, positions: mergeIdenticalPositions(positions) };
}

function mergeIdenticalPositions(positions: BrokerPosition[]): BrokerPosition[] {
  const merged = new Map<string, BrokerPosition>();
  for (const position of positions) {
    const key = [
      position.accountId ?? "",
      position.ticker,
      position.assetCategory ?? "",
      position.exchange ?? "",
      position.brokerContract?.conId ?? "",
    ].join(":");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, position);
      continue;
    }
    const shares = existing.shares + position.shares;
    const existingCost = (existing.avgCost ?? 0) * existing.shares;
    const nextCost = (position.avgCost ?? 0) * position.shares;
    merged.set(key, {
      ...existing,
      shares,
      avgCost: shares > 0 ? (existingCost + nextCost) / shares : existing.avgCost,
      marketValue: sumOptional(existing.marketValue, position.marketValue),
      unrealizedPnl: sumOptional(existing.unrealizedPnl, position.unrealizedPnl),
    });
  }
  return [...merged.values()];
}

function sumOptional(left?: number, right?: number): number | undefined {
  if (left == null && right == null) return undefined;
  return (left ?? 0) + (right ?? 0);
}

export function normalizeRobinhoodSnapshot(accountsPayload: unknown, positionsPayload: unknown): BrokerPortfolioSnapshot {
  const accounts = allRecords(accountsPayload).flatMap((item): BrokerAccount[] => {
    const id = accountId(item);
    if (!id) return [];
    const type = text(item.accountType, item.account_type, item.type);
    const currency = text(item.currency, item.baseCurrency, item.base_currency, "USD").toUpperCase();
    return [{
      accountId: id,
      name: text(item.name, item.accountName, item.account_name, type && titleCase(type), id),
      currency,
      netLiquidation: numberValue(item.totalValue, item.total_value, item.portfolioValue, item.portfolio_value),
      buyingPower: numberValue(item.buyingPower, item.buying_power),
    }];
  });

  const positions = allRecords(positionsPayload).flatMap((item): BrokerPosition[] => {
    const instrument = nested(item, "instrument");
    const account = nested(item, "account");
    const costBasis = record(item.costBasis) ?? record(item.cost_basis) ?? {};
    const lastPrice = record(item.lastPrice) ?? record(item.last_price) ?? {};
    const symbol = text(item.symbol, item.ticker, instrument.symbol).toUpperCase();
    const shares = numberValue(item.quantity, item.shares, item.qty);
    if (!symbol || shares == null || shares === 0) return [];
    const totalCost = numberValue(
      item.totalCost,
      item.total_cost,
      typeof item.costBasis === "object" ? undefined : item.costBasis,
      typeof item.cost_basis === "object" ? undefined : item.cost_basis,
      costBasis.totalCost,
      costBasis.total_cost,
    );
    const avgCost = numberValue(
      item.averageCost,
      item.average_cost,
      item.averageBuyPrice,
      item.average_buy_price,
      item.costBasisPerShare,
      item.cost_basis_per_share,
      costBasis.unitCost,
      costBasis.unit_cost,
      totalCost != null ? totalCost / Math.abs(shares) : undefined,
    );
    const marketValue = numberValue(item.marketValue, item.market_value, item.currentValue, item.current_value);
    const markPrice = numberValue(
      item.markPrice,
      item.mark_price,
      item.price,
      item.lastPrice,
      item.last_price,
      lastPrice.lastPrice,
      lastPrice.last_price,
      lastPrice.price,
      marketValue != null ? marketValue / Math.abs(shares) : undefined,
    );
    return [{
      ticker: symbol,
      exchange: text(item.exchange, instrument.exchange, "SMART").toUpperCase(),
      shares,
      avgCost,
      currency: text(item.currency, instrument.currency, "USD").toUpperCase(),
      accountId: accountId(item) || accountId(account) || undefined,
      name: text(item.name, item.description, instrument.name, symbol),
      assetCategory: "STK",
      markPrice,
      marketValue,
      unrealizedPnl: numberValue(item.unrealizedPnl, item.unrealized_pnl, item.unrealizedGain, item.unrealized_gain),
      side: shares < 0 ? "short" : "long",
    }];
  });

  return uniqueSnapshot(accounts, positions);
}
