import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "../../../ui";
import {
  DataTableView,
  PaneStatusBody,
  type DataTableCell,
  type DataTableColumn,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../components";
import { CompositeChart } from "../../../components/chart/composite";
import { staticSeries } from "../../../components/chart/static/series";
import { openUrl } from "../../../components/ui/external-link";
import { useShortcut } from "../../../react/input";
import { useAppSelector } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint } from "../../../types/financials";
import type { TimeRange } from "../../../time-series/range";
import { isPlainKey } from "../../../utils/keyboard";
import { applySortPreference, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAssetData, usePluginPaneState } from "../../runtime";
import { useAutoRefresh } from "../shared/auto-refresh";
import { usePaneStatusFooter } from "../shared/pane-footer";
import { usePlanAccess } from "../shared/plan-access";
import { useQuoteBoard } from "../shared/use-quote-board";
import type { MnaDeal, MnaDealEvent, MnaDealPayload } from "../../../api-client/mna";
import { isAccessDenied, loadMnaDeal, peekMnaDeal, type MnaResource } from "./client";
import {
  dealSpread,
  formatDealValue,
  formatExpectedClose,
  formatListDate,
  formatPercentShort,
  formatPerShare,
  formatPrice,
  MISSING,
  stageLabel,
  termsLabel,
} from "./model";

/** "ACV Auctions Inc. ← Copart, Inc.": the target, then who is buying it. */
export function mnaDealTitle(deal: MnaDeal): string {
  return deal.acquirer ? `${deal.target.name} ← ${deal.acquirer.name}` : deal.target.name;
}

type EventColumnId = "date" | "title" | "source";

const TIMELINE_COLUMNS: DataTableColumn[] = [
  { id: "date", label: "DATE", width: 8, align: "left" },
  { id: "title", label: "EVENT", width: 30, align: "left", flexGrow: 1 },
  { id: "source", label: "SOURCE", width: 14, align: "left" },
];

const EVENT_TEXT_SORT = new Set<EventColumnId>(["title", "source"]);
const NO_SYMBOLS: string[] = [];
const NO_EVENTS: MnaDealEvent[] = [];
const NO_INFO: PaneFooterSegment[] = [];
const NO_HINTS: PaneHint[] = [];

/** History starts this long before the announcement, so the jump shows. */
const LEAD_DAYS = 45;

function isEventColumnId(id: string): id is EventColumnId {
  return id === "date" || id === "title" || id === "source";
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function dayOf(point: PricePoint): string {
  return point.date.toISOString().slice(0, 10);
}

async function dailyCloses(provider: DataProvider, symbol: string, from: string): Promise<PricePoint[]> {
  const ageDays = (Date.now() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  const range: TimeRange = ageDays < 170 ? "6M" : ageDays < 350 ? "1Y" : "5Y";
  const points = provider.getPriceHistoryForResolution
    ? await provider.getPriceHistoryForResolution(symbol, "", range, "1d")
    : await provider.getPriceHistory(symbol, "", range);
  return points.filter((point) => Number.isFinite(point.close) && dayOf(point) >= from);
}

function useDealHistory(deal: MnaDeal | null) {
  const provider = useAssetData();
  const target = deal?.target.symbol ?? null;
  const ratio = deal?.terms.exchangeRatio != null ? deal.terms.ratioSymbol : null;
  const from = deal ? shiftDay(deal.announced, -LEAD_DAYS) : null;
  const [history, setHistory] = useState<{ key: string; target: PricePoint[]; ratio: PricePoint[] } | null>(null);
  const key = `${target ?? ""}:${ratio ?? ""}:${from ?? ""}`;
  useEffect(() => {
    if (!provider || !target || !from) return;
    let cancelled = false;
    void Promise.all([
      dailyCloses(provider, target, from),
      ratio ? dailyCloses(provider, ratio, from) : Promise.resolve([]),
    ]).then(([targetPoints, ratioPoints]) => {
      if (!cancelled) setHistory({ key, target: targetPoints, ratio: ratioPoints });
    }).catch(() => {
      if (!cancelled) setHistory({ key, target: [], ratio: [] });
    });
    return () => { cancelled = true; };
  }, [from, key, provider, ratio, target]);
  return history?.key === key ? history : null;
}

/**
 * What the terms were worth each day since the announcement. Cash is flat.
 * Stock is the ratio times the paying listing's close.
 */
function offerSeries(deal: MnaDeal, ratioCloses: readonly PricePoint[], days: readonly string[]): Array<{ day: string; value: number }> {
  const { cashPerShare, exchangeRatio, currency } = deal.terms;
  if (cashPerShare == null && exchangeRatio == null) return [];
  const pence = currency === "GBp" || currency === "GBX";
  const cash = cashPerShare == null ? 0 : pence ? cashPerShare / 100 : cashPerShare;
  const ratioByDay = new Map(ratioCloses.map((point) => [dayOf(point), point.close]));
  const out: Array<{ day: string; value: number }> = [];
  let lastRatio: number | null = null;
  for (const day of days) {
    if (day < deal.announced) continue;
    if (exchangeRatio == null) {
      out.push({ day, value: cash });
      continue;
    }
    lastRatio = ratioByDay.get(day) ?? lastRatio;
    if (lastRatio != null) out.push({ day, value: cash + exchangeRatio * lastRatio });
  }
  return out;
}

interface DetailState {
  key: string;
  resource: MnaResource<MnaDealPayload> | null;
  loading: boolean;
  error: string | null;
}

interface StatLine {
  id: string;
  label: string;
  value: string;
  tone?: "warning";
}

export function MnaDealDetail({ id, seed, focused, width, height }: {
  id: string;
  /** The list's copy, drawn while the full deal loads. */
  seed: MnaDeal | null;
  focused: boolean;
  width: number;
  height: number;
}) {
  const pro = usePlanAccess().hasProAccess;
  const refreshMinutes = useAppSelector((state) => state.config.refreshIntervalMinutes);
  const [storedEvent, setStoredEvent] = usePluginPaneState<string>(`mna:event:${id}`, "");
  const [eventSort, setEventSort] = useState<SortPreference<EventColumnId>>({ columnId: null, direction: "desc" });
  const [detail, setDetail] = useState<DetailState>({ key: "", resource: null, loading: true, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  const forceRef = useRef(false);

  const reload = useCallback((force: boolean) => {
    forceRef.current = force;
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    const force = forceRef.current;
    forceRef.current = false;
    let cancelled = false;
    const peeked = force ? null : peekMnaDeal(id, pro);
    if (peeked && !peeked.stale) {
      setDetail({ key: id, resource: peeked, loading: false, error: null });
      return;
    }
    setDetail((current) => ({
      key: id,
      resource: peeked ?? (current.key === id ? current.resource : null),
      loading: true,
      error: null,
    }));
    void loadMnaDeal(id, pro, { force })
      .then((resource) => {
        if (cancelled) return;
        setDetail({ key: id, resource, loading: false, error: resource.refreshError });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setDetail((current) => ({
          key: id,
          resource: isAccessDenied(error) || current.key !== id ? null : current.resource,
          loading: false,
          error: message,
        }));
      });
    return () => { cancelled = true; };
  }, [id, pro, reloadToken]);

  const ready = detail.key === id;
  const resource = ready ? detail.resource : null;
  const payload = resource?.payload ?? null;
  const deal = payload?.deal ?? seed;
  const events = payload?.events ?? NO_EVENTS;
  const loading = !ready || detail.loading;
  const error = ready ? detail.error : null;

  useAutoRefresh(resource?.fetchedAt ?? null, () => reload(true));
  useShortcut((event) => {
    if (!focused || event.targetEditable || !isPlainKey(event, "r")) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    reload(true);
  }, { enabled: focused });

  const quoteKey = deal?.status === "pending"
    ? [deal.target.symbol, deal.terms.exchangeRatio != null ? deal.terms.ratioSymbol : null].filter(Boolean).join("\n")
    : "";
  const quoteSymbols = useMemo(() => (quoteKey ? quoteKey.split("\n") : NO_SYMBOLS), [quoteKey]);
  const { quotes } = useQuoteBoard(quoteSymbols, Math.max(1, refreshMinutes || 1) * 60_000);
  const targetQuote = deal?.target.symbol ? quotes.get(deal.target.symbol)?.quote ?? null : null;
  const ratioQuote = deal?.terms.ratioSymbol ? quotes.get(deal.terms.ratioSymbol)?.quote ?? null : null;
  const spread = deal ? dealSpread(deal, targetQuote, ratioQuote) : null;
  const history = useDealHistory(deal);

  const unaffected = useMemo(() => {
    if (!deal || !history) return null;
    const before = history.target.filter((point) => dayOf(point) < deal.announced);
    return before.at(-1) ?? null;
  }, [deal, history]);

  const stats = useMemo<StatLine[]>(() => {
    if (!deal) return [];
    const items: StatLine[] = [];
    const terms = termsLabel(deal.terms);
    if (spread) {
      const currency = targetQuote?.currency ?? null;
      items.push({ id: "offer", label: "Offer", value: formatPerShare(spread.offer, currency, 2) });
      items.push({
        id: "spread",
        label: "Spread",
        value: formatPercentShort(spread.spread),
        tone: spread.spread < 0 ? "warning" : undefined,
      });
      if (spread.annualized != null) items.push({ id: "ann", label: "Ann.", value: formatPercentShort(spread.annualized) });
      if (unaffected && unaffected.close > 0 && deal.terms.exchangeRatio == null) {
        items.push({
          id: "premium",
          label: "Premium",
          value: formatPercentShort(spread.offer / unaffected.close - 1),
        });
      }
    } else if (terms !== MISSING) {
      items.push({ id: "terms", label: "Terms", value: terms });
    } else if (deal.terms.cashPerShare != null) {
      items.push({ id: "terms", label: "Terms", value: formatPerShare(deal.terms.cashPerShare, deal.terms.currency) });
    }
    items.push({ id: "value", label: "Value", value: formatDealValue(deal.value, deal.valueCurrency) });
    if (deal.status === "completed" || deal.status === "terminated") {
      items.push({
        id: "closed",
        label: deal.status === "completed" ? "Closed" : "Ended",
        value: deal.closed ? formatListDate(deal.closed) : MISSING,
      });
    } else {
      items.push({ id: "close", label: "Close", value: formatExpectedClose(deal.expectedClose) });
    }
    items.push({ id: "stage", label: "Stage", value: stageLabel(deal) });
    return items;
  }, [deal, spread, targetQuote?.currency, unaffected]);

  const series = useMemo(() => {
    if (!deal?.target.symbol || !history || history.target.length < 3) return [];
    const days = history.target.map(dayOf);
    const offer = offerSeries(deal, history.ratio, days);
    const priced = [
      staticSeries(
        history.target.map((point) => ({ date: point.date, observedAt: point.date, value: point.close })),
        { id: "target", label: deal.target.symbol, color: colors.text, calendarSpaced: true },
      ),
    ];
    if (offer.length >= 2) {
      priced.push(staticSeries(
        offer.map((row) => {
          const date = new Date(`${row.day}T00:00:00Z`);
          return { date, observedAt: date, value: row.value };
        }),
        { id: "offer", label: "Offer", color: colors.positive, calendarSpaced: true },
      ));
    }
    return priced;
  }, [deal, history]);

  const sortedEvents = useMemo(() => applySortPreference(events, eventSort, (event, columnId) => {
    if (columnId === "date") return event.date;
    if (columnId === "title") return event.title;
    return event.source;
  }), [eventSort, events]);
  const selected = events.find((event) => event.id === storedEvent) ?? events[0] ?? null;
  const openSelected = useCallback(() => {
    if (selected?.url) openUrl(selected.url);
  }, [selected?.url]);

  const staleInfo = useMemo<PaneFooterSegment[]>(
    () => (resource?.stale ? [{ id: "stale", parts: [{ text: "stale", tone: "warning" }] }] : NO_INFO),
    [resource?.stale],
  );
  const hints = useMemo<PaneHint[]>(
    () => (selected?.url ? [{ id: "open", key: "o", label: "pen", onPress: openSelected }] : NO_HINTS),
    [openSelected, selected?.url],
  );
  usePaneStatusFooter({
    registrationId: "mna:detail",
    focused,
    loading,
    error,
    info: staleInfo,
    hints,
  });

  const onHeaderClick = useCallback((columnId: string) => {
    if (!isEventColumnId(columnId)) return;
    setEventSort((current) => nextSortPreference(current, columnId, {
      defaultDirection: (id) => (EVENT_TEXT_SORT.has(id) ? "asc" : "desc"),
      resetTo: { columnId: null, direction: "desc" },
    }));
  }, []);

  const renderCell = useCallback((event: MnaDealEvent, column: DataTableColumn, _index: number, state: { selected: boolean }): DataTableCell => {
    const base = state.selected ? colors.selectedText : colors.text;
    const muted = state.selected ? colors.selectedText : colors.textMuted;
    if (column.id === "date") return { text: formatListDate(event.date), color: muted };
    if (column.id === "source") return { text: event.source, color: muted };
    return { text: event.title, color: base };
  }, []);

  const chartHeight = series.length > 0 && height >= 16 ? Math.max(6, Math.floor(height * 0.4)) : 0;

  return (
    <PaneStatusBody loading={loading && !deal} error={!deal ? error : null} subject="deal">
      {deal ? (
        <Box width={width} height={height} flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" paddingX={1} gap={2} flexShrink={0}>
            {stats.map((stat) => (
              <Box key={stat.id} flexDirection="row" gap={1}>
                <Text fg={colors.textMuted}>{stat.label}</Text>
                <Text fg={stat.tone === "warning" ? colors.warning : colors.text}>{stat.value}</Text>
              </Box>
            ))}
          </Box>
          {deal.headline ? (
            <Box paddingX={1} flexShrink={0}>
              <Text fg={colors.textMuted} wrapMode="word">{deal.headline}</Text>
            </Box>
          ) : null}
          {chartHeight > 0 ? (
            <CompositeChart
              series={series}
              panels={[{ id: "main" }]}
              width={width}
              height={chartHeight}
              focused={false}
              interactive={false}
              navigable={false}
              showLegend
              showTimeAxis
              formatValue={(value) => formatPrice(value)}
              remoteKind="mna-deal"
            />
          ) : null}
          <DataTableView<MnaDealEvent>
            columns={TIMELINE_COLUMNS}
            items={sortedEvents}
            focused={focused}
            rootWidth={width}
            selection={{
              kind: "id",
              selectedId: selected?.id ?? null,
              getId: (event) => event.id,
              onChange: (eventId) => setStoredEvent(eventId),
            }}
            getItemKey={(event) => event.id}
            onActivate={(event) => { if (event.url) openUrl(event.url); }}
            sortColumnId={eventSort.columnId}
            sortDirection={eventSort.direction}
            onHeaderClick={onHeaderClick}
            renderCell={renderCell}
            emptyStateTitle={loading ? "Loading..." : "No events yet."}
          />
        </Box>
      ) : null}
    </PaneStatusBody>
  );
}
