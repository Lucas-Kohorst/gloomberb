import { usePaneFooter, useUpdatedAgo } from "../../../components";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import { paneSearchHint } from "../shared/pane-footer";
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
  const updatedAgo = useUpdatedAgo(lastUpdated);
  usePaneFooter(CONGRESS_TRADES_PANE_ID, () => ({
    info: [
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    trailingInfo: [poll.segment],
    hints: [
      paneSearchHint(focusSearch),
      ...(detailMode?.kind !== "member" && activeTab === "trades" && (detailTrade ?? selectedTrade)
        ? [
            { id: "member", key: "m", label: "ember", onPress: openSelectedTradeMember },
            { id: "ticker", key: "t", label: "icker", onPress: openSelectedTicker, disabled: !(detailTrade?.ticker ?? selectedTrade?.ticker) },
            { id: "open", key: "o", label: "pen", onPress: openSelectedTradeSource, disabled: !(detailTrade ?? selectedTrade)?.sourceUrl },
          ]
        : []),
    ],
  }), [
    activeTab,
    detailMode,
    detailTrade,
    error,
    focusSearch,
    openSelectedTicker,
    openSelectedTradeMember,
    openSelectedTradeSource,
    payload,
    poll.segment,
    selectedTrade,
    status,
    updatedAgo,
  ]);
}
