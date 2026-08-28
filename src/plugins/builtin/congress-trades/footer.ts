import { usePaneFooter } from "../../../components";
import { formatTimeAgo } from "../../../utils/format";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import type {
  CloudCongressHousePayload,
  CloudCongressTradePayload,
} from "../../../api-client";
import {
  CONGRESS_TRADES_PANE_ID,
  type CongressTab,
  type DetailMode,
  type LoadStatus,
} from "./model";

export function useCongressTradesFooter({
  activeTab,
  detailMode,
  detailTrade,
  error,
  load,
  openSelectedTicker,
  openSelectedTradeMember,
  openSelectedTradeSource,
  payload,
  selectedTrade,
  focusSearch,
  status,
  lastUpdated,
}: {
  activeTab: CongressTab;
  detailMode: DetailMode;
  detailTrade: CloudCongressTradePayload | null;
  error: string | null;
  load: (refresh?: boolean) => void;
  openSelectedTicker: () => void;
  openSelectedTradeMember: () => void;
  openSelectedTradeSource: () => void;
  payload: CloudCongressHousePayload | null;
  selectedTrade: CloudCongressTradePayload | null;
  focusSearch: () => void;
  status: LoadStatus;
  lastUpdated: number | null;
}) {
  const poll = useFeedPollInterval();
  useAutoRefresh(lastUpdated, () => load(true), poll.intervalMinutes);
  usePaneFooter(CONGRESS_TRADES_PANE_ID, () => ({
    info: [
      ...(payload ? [
        { id: "asof", parts: [{ text: `updated ${formatTimeAgo(payload.asOf)}`, tone: "muted" as const }] },
      ] : []),
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    trailingInfo: [poll.segment],
    hints: detailMode?.kind === "member"
      ? []
      : [
          { id: "refresh", key: "r", label: "efresh", onPress: () => load(true) },
          { id: "search", key: "/", label: "earch", onPress: focusSearch },
          ...(activeTab === "trades" ? [
            { id: "member", key: "m", label: "ember", onPress: openSelectedTradeMember, disabled: !selectedTrade },
            { id: "ticker", key: "t", label: "icker", onPress: openSelectedTicker, disabled: !(detailTrade?.ticker ?? selectedTrade?.ticker) },
            { id: "open", key: "o", label: "pen", onPress: openSelectedTradeSource, disabled: !(detailTrade ?? selectedTrade)?.sourceUrl },
          ] : []),
        ],
  }), [
    activeTab,
    detailMode,
    detailTrade,
    error,
    focusSearch,
    load,
    lastUpdated,
    openSelectedTicker,
    openSelectedTradeMember,
    openSelectedTradeSource,
    payload,
    selectedTrade,
    status,
    poll.segment,
  ]);
}
