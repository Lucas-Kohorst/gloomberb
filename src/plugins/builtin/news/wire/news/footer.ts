import { useCallback, useMemo } from "react";
import type { PaneFooterSegment } from "../../../../../components";
import { tf } from "../../../../../i18n";
import { useAppLanguage } from "../../../../../i18n/react";
import { useShortcut } from "../../../../../react/input";
import { useUiCapabilities } from "../../../../../ui";
import { isPlainKey } from "../../../../../utils/keyboard";
import { useCloudAccessFooter } from "../../../shared/cloud-upgrade";
import { CLOUD_NEWS_DELAY_HOURS } from "../../../../../api-client/plan-access";
import { usePaneStatusLinkFooter } from "../../../../../components/layout/pane/status-footer";
import { useRefreshPollTrailing, useUpdatedFooterInfo } from "../../../../../components/layout/pane/freshness-footer";
import { usePluginAppActions } from "../../../../runtime";
import { useOptionalPaneInstanceId } from "../../../../../state/app/context";

interface NewsFooterArticle {
  title?: string | null;
  source?: string | null;
  url?: string | null;
}

interface UseNewsArticleFooterOptions {
  registrationId: string;
  focused: boolean;
  article: NewsFooterArticle | null | undefined;
  info?: PaneFooterSegment[];
  loading?: boolean;
  error?: string | null;
  onPopOut?: () => void;
  /** Last successful fetch. Article readers omit this and do not show a poll. */
  updatedAt?: number | null;
}

export function useNewsArticleFooter({
  registrationId,
  focused,
  article,
  info,
  loading = false,
  error,
  onPopOut,
  updatedAt,
}: UseNewsArticleFooterOptions) {
  const language = useAppLanguage();
  const { publicSharing } = useUiCapabilities();
  const { sharePane } = usePluginAppActions();
  const paneInstanceId = useOptionalPaneInstanceId();
  // The open story is pane state, so sharing the pane shares the story: the
  // receiver's terminal opens on the same article.
  const shareArticle = useCallback(() => {
    if (!article?.title || !paneInstanceId) return;
    sharePane(paneInstanceId);
  }, [article?.title, paneInstanceId, sharePane]);
  useShortcut((event) => {
    if (!focused || !publicSharing || !article?.title || !isPlainKey(event, "y")) return;
    event.preventDefault();
    event.stopPropagation();
    shareArticle();
  });
  const { access, hint: upgradeHint, segment } = useCloudAccessFooter({
    delayLabel: tf("{count}h", { count: CLOUD_NEWS_DELAY_HOURS }),
    focused,
    segmentId: "news-access",
    placement: "news-footer",
    shortcutScope: `${registrationId}:news-upgrade`,
  });

  const accessInfo = useMemo<PaneFooterSegment[]>(
    () => (access.isPayingPro || !segment ? [] : [segment]),
    [access.isPayingPro, language, segment],
  );
  const updatedInfo = useUpdatedFooterInfo(updatedAt);
  const footerInfo = useMemo(() => [...updatedInfo, ...accessInfo, ...(info ?? [])], [accessInfo, info, updatedInfo]);
  // Lists pass updatedAt and show the refresh interval. Article readers omit it.
  const trailingInfo = useRefreshPollTrailing(updatedAt != null);

  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info: footerInfo,
    trailingInfo,
    // [o]pen is appended after these, so the story's own actions stay rightmost.
    hints: [
      ...(upgradeHint ? [upgradeHint] : []),
      ...(publicSharing && article?.title && paneInstanceId
        ? [{ id: "share", key: "y", label: " share", onPress: shareArticle }]
        : []),
      ...(onPopOut ? [{ id: "pop-out", key: "p", label: "op out", onPress: onPopOut }] : []),
    ],
    showOpenHint: true,
    loading,
    error,
  });
}
