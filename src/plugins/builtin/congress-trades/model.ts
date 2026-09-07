import type { DataTableColumn } from "../../../components";
import { formatCompact } from "../../../utils/format";

export { truncateWithEllipsis as truncate } from "../../../utils/text-wrap";
import type {
  CloudCongressHousePayload,
  CloudCongressMemberPayload,
  CloudCongressTradePayload,
} from "../../../api-client";
import type { CloudCongressHouseParams } from "../../../api-client/paths";

export const CONGRESS_TRADES_PANE_ID = "congress-trades";
export const CONGRESS_TRADE_LIMIT = 200;
export const CONGRESS_FILING_LIMIT = 60;
export const CONGRESS_MEMBER_TRADE_LIMIT = 2000;
export const CONGRESS_MEMBER_FILING_LIMIT = 500;

export type CongressTab = "trades" | "members";
export type LoadStatus = "idle" | "loading" | "loaded" | "error";
export type SortDirection = "asc" | "desc";
export type DetailMode =
  | { kind: "trade"; tradeId: string }
  | { kind: "member"; memberId: string }
  | null;

export type TradeColumnId =
  | "filed"
  | "tx"
  | "lag"
  | "member"
  | "side"
  | "ticker"
  | "amount"
  | "asset"
  | "owner";
export type TradeColumn = DataTableColumn & { id: TradeColumnId };
export type MemberColumnId =
  | "member"
  | "district"
  | "trades"
  | "buys"
  | "sells"
  | "range"
  | "last"
  | "lag";
export type MemberColumn = DataTableColumn & { id: MemberColumnId };

export function formatShortDate(value: string | null): string {
  if (!value) return "--";
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatLag(value: number | null): string {
  return value == null ? "--" : `${value}d`;
}

function formatMoneyShort(value: number | null): string {
  if (value == null) return "--";
  return `$${formatCompact(value)}`;
}

export function formatAmountRange(low: number | null, high: number | null, raw?: string): string {
  if (low == null && high == null) return raw || "--";
  if (low != null && high == null) return `>${formatMoneyShort(low)}`;
  if (low != null && high != null && low !== high) {
    return `${formatMoneyShort(low)}-${formatMoneyShort(high).replace(/^\$/, "")}`;
  }
  return formatMoneyShort(low ?? high);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

function compareTrade(
  left: CloudCongressTradePayload,
  right: CloudCongressTradePayload,
  columnId: TradeColumnId,
): number {
  switch (columnId) {
    case "filed":
      return dateValue(left.filingDate) - dateValue(right.filingDate);
    case "tx":
      return dateValue(left.transactionDate) - dateValue(right.transactionDate);
    case "lag":
      return (left.lagDays ?? -1) - (right.lagDays ?? -1);
    case "member":
      return compareText(left.memberName, right.memberName);
    case "side":
      return compareText(left.side, right.side);
    case "ticker":
      return compareText(left.ticker ?? "", right.ticker ?? "");
    case "amount":
      return (left.amountHigh ?? left.amountLow ?? 0) - (right.amountHigh ?? right.amountLow ?? 0);
    case "asset":
      return compareText(left.assetName, right.assetName);
    case "owner":
      return compareText(left.owner, right.owner);
  }
}

function compareMember(
  left: CloudCongressMemberPayload,
  right: CloudCongressMemberPayload,
  columnId: MemberColumnId,
): number {
  switch (columnId) {
    case "member":
      return compareText(left.memberName, right.memberName);
    case "district":
      return compareText(left.stateDistrict, right.stateDistrict);
    case "trades":
      return left.tradeCount - right.tradeCount;
    case "buys":
      return left.buyCount - right.buyCount;
    case "sells":
      return left.sellCount - right.sellCount;
    case "range":
      return (left.estimatedHigh ?? left.estimatedLow ?? 0) - (right.estimatedHigh ?? right.estimatedLow ?? 0);
    case "last":
      return dateValue(left.lastFilingDate) - dateValue(right.lastFilingDate);
    case "lag":
      return (left.avgLagDays ?? -1) - (right.avgLagDays ?? -1);
  }
}

export function nextSort<TColumn extends string>(
  current: { columnId: TColumn; direction: SortDirection },
  columnId: TColumn,
  defaultDirection: SortDirection,
): { columnId: TColumn; direction: SortDirection } {
  if (current.columnId !== columnId) {
    return { columnId, direction: defaultDirection };
  }
  return {
    columnId,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function buildTradeColumns(): TradeColumn[] {
  return [
    { id: "filed", label: "FILED", width: 7, align: "left" },
    { id: "tx", label: "TX", width: 7, align: "left" },
    { id: "lag", label: "LAG", width: 5, align: "right" },
    { id: "member", label: "MEMBER", width: 14, align: "left", flexGrow: 1 },
    { id: "side", label: "SIDE", width: 5, align: "left" },
    { id: "ticker", label: "TICKER", width: 12, align: "left" },
    { id: "amount", label: "AMOUNT", width: 14, align: "right" },
    { id: "owner", label: "OWNER", width: 8, align: "left" },
  ];
}

export function buildMemberTradeColumns(): TradeColumn[] {
  return [
    { id: "filed", label: "FILED", width: 7, align: "left" },
    { id: "tx", label: "TX", width: 7, align: "left" },
    { id: "side", label: "SIDE", width: 8, align: "left" },
    { id: "ticker", label: "TICKER", width: 12, align: "left" },
    { id: "amount", label: "AMOUNT", width: 14, align: "right" },
    { id: "asset", label: "ASSET", width: 18, align: "left", flexGrow: 1 },
    { id: "owner", label: "OWNER", width: 8, align: "left" },
    { id: "lag", label: "LAG", width: 5, align: "right" },
  ];
}

export function buildMemberColumns(): MemberColumn[] {
  return [
    { id: "member", label: "MEMBER", width: 18, align: "left", flexGrow: 1 },
    { id: "district", label: "DIST", width: 6, align: "left" },
    { id: "trades", label: "TRADES", width: 7, align: "right" },
    { id: "buys", label: "BUY", width: 5, align: "right" },
    { id: "sells", label: "SELL", width: 6, align: "right" },
    { id: "range", label: "EST RANGE", width: 17, align: "right" },
    { id: "last", label: "LAST", width: 7, align: "left" },
    { id: "lag", label: "AVG", width: 6, align: "right" },
  ];
}

export function sortedTrades(
  trades: CloudCongressTradePayload[],
  sort: { columnId: TradeColumnId; direction: SortDirection },
): CloudCongressTradePayload[] {
  return [...trades].sort((left, right) => {
    const comparison = compareTrade(left, right, sort.columnId);
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    return dateValue(right.filingDate) - dateValue(left.filingDate);
  });
}

export function sortedMembers(
  members: CloudCongressMemberPayload[],
  sort: { columnId: MemberColumnId; direction: SortDirection },
): CloudCongressMemberPayload[] {
  return [...members].sort((left, right) => {
    const comparison = compareMember(left, right, sort.columnId);
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    return left.memberName.localeCompare(right.memberName);
  });
}

export function selectedIndexById<T extends { id: string }>(rows: T[], selectedId: string | null): number {
  const index = rows.findIndex((row) => row.id === selectedId);
  return index >= 0 ? index : rows.length > 0 ? 0 : -1;
}

function congressFilingOffset(payload: CloudCongressHousePayload): number {
  return payload.filingOffset ?? 0;
}

function congressHasMoreFilings(payload: CloudCongressHousePayload): boolean {
  if (payload.hasMoreFilings === true) return true;
  if (payload.hasMoreFilings === false) return false;
  return congressFilingOffset(payload) + payload.filingsScanned < payload.filingCount;
}

export function canLoadMoreCongress(payload: CloudCongressHousePayload): boolean {
  return nextCongressPage(payload) != null;
}

export function nextCongressPage(payload: CloudCongressHousePayload): CloudCongressHouseParams | null {
  if (payload.hasMore) {
    return {
      year: payload.year,
      offset: payload.nextOffset ?? 0,
      filingOffset: congressFilingOffset(payload),
    };
  }
  if (congressHasMoreFilings(payload)) {
    return {
      year: payload.year,
      offset: 0,
      filingOffset: payload.nextFilingOffset ?? congressFilingOffset(payload) + payload.filingsScanned,
    };
  }
  if (payload.year > 2008) {
    return { year: payload.year - 1, offset: 0, filingOffset: 0 };
  }
  return null;
}

export function congressPageAfterEmpty(payload: CloudCongressHousePayload): CloudCongressHousePayload {
  return {
    ...payload,
    hasMore: false,
    hasMoreFilings: false,
    filingCount: payload.filingsScanned,
    nextFilingOffset: congressFilingOffset(payload) + payload.filingsScanned,
  };
}

export function mergeCongressPages(
  current: CloudCongressHousePayload,
  next: CloudCongressHousePayload,
): CloudCongressHousePayload {
  const trades = [...current.trades];
  const seenTrades = new Set(current.trades.map((trade) => trade.id));
  for (const trade of next.trades) {
    if (seenTrades.has(trade.id)) continue;
    seenTrades.add(trade.id);
    trades.push(trade);
  }
  const members = [...current.members];
  const seenMembers = new Set(current.members.map((member) => member.id));
  for (const member of next.members) {
    if (seenMembers.has(member.id)) continue;
    seenMembers.add(member.id);
    members.push(member);
  }
  return { ...next, trades, members };
}
