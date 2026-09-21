import { useMemo } from "react";
import { useUpdatedAgo, type PaneFooterSegment, type PaneHint } from "../../../components";
import { usePaneStatusLinkFooter, paneSearchHint } from "../shared/pane-footer";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../shared/feed-poll-interval";
import type { SubstackAuthState } from "./api/types";
import { SUBSTACK_PANE_ID, type SubstackArticleSummary } from "./types";
import type { ActiveFeedState, DetailState } from "./pane-state";

export function useSubstackPaneFooter({
  auth,
  focused,
  detailOpen,
  activeFeedState,
  activeDetail,
  selectedArticle,
  openSelectedArticle,
  popOutArticle,
  focusSearch,
}: {
  auth: SubstackAuthState | null;
  focused: boolean;
  detailOpen: boolean;
  activeFeedState: ActiveFeedState;
  activeDetail: DetailState;
  selectedArticle: SubstackArticleSummary | null;
  openSelectedArticle: () => void;
  popOutArticle: () => void;
  focusSearch: () => void;
}) {
  const updatedAgo = useUpdatedAgo(activeFeedState.fetchedAt);
  const poll = useFeedPollInterval();
  const loading = activeFeedState.loading
    || activeFeedState.loadingMore
    || (detailOpen && activeDetail.loading);
  const error = activeFeedState.error
    ?? (detailOpen ? activeDetail.error : null);
  const info = useMemo<PaneFooterSegment[]>(() => {
    if (!auth || !updatedAgo) return [];
    return [{
      id: "updated",
      parts: [{
        text: activeFeedState.stale ? `stale ${updatedAgo}` : `updated ${updatedAgo}`,
        tone: activeFeedState.stale ? "warning" : "muted",
      }],
    }];
  }, [activeFeedState.stale, auth, updatedAgo]);
  const trailingHints = useMemo<PaneHint[]>(() => {
    if (!auth) return [];
    const hints: PaneHint[] = [paneSearchHint(focusSearch)];
    if (selectedArticle) {
      hints.push({
        id: "pop-out",
        key: "p",
        label: "op out",
        onPress: popOutArticle,
      });
    }
    return hints;
  }, [auth, focusSearch, popOutArticle, selectedArticle]);

  usePaneStatusLinkFooter({
    registrationId: SUBSTACK_PANE_ID,
    focused,
    url: selectedArticle?.url,
    source: selectedArticle?.publicationName,
    label: "article",
    loading,
    error,
    info,
    trailingInfo: pollFooterTrailingInfo(!!auth && !detailOpen, poll.segment),
    trailingHints,
    showOpenHint: !!auth,
    onOpen: openSelectedArticle,
  });
}
