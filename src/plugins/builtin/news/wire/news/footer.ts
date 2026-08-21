import { useMemo } from "react";
import { useShortcut } from "../../../../../react/input";
import type { PaneFooterSegment, PaneHint } from "../../../../../components";
import { t, tf } from "../../../../../i18n";
import { useAppLanguage } from "../../../../../i18n/react";
import { useCloudAccessFooter } from "../../../shared/cloud-upgrade";
import { CLOUD_NEWS_DELAY_HOURS } from "../../../shared/plan-access";
import { usePaneStatusLinkFooter } from "../../../shared/pane-footer";
import { useFeedPollInterval } from "../../../shared/feed-poll-interval";
import { useArticleArchiveAction } from "../../../shared/article-archive";

interface NewsFooterArticle {
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
  onRefresh?: () => void;
  onShare?: () => void;
}

export function useNewsArticleFooter({
  registrationId,
  focused,
  article,
  info,
  loading = false,
  error,
  onPopOut,
  onRefresh,
  onShare,
}: UseNewsArticleFooterOptions) {
  const language = useAppLanguage();
  const archiveAction = useArticleArchiveAction(article?.url);
  const { access, segment } = useCloudAccessFooter({
    delayLabel: tf("{count}h", { count: CLOUD_NEWS_DELAY_HOURS }),
    focused,
    segmentId: "news-access",
    shortcutScope: `${registrationId}:news-upgrade`,
  });

  const accessInfo = useMemo<PaneFooterSegment[]>(() => {
    if (access.isPayingPro) {
      return [{ id: "news-access", parts: [{ text: t("real-time news"), tone: "positive" }] }];
    }
    return segment ? [segment] : [];
  }, [access.isPayingPro, language, segment]);
  const poll = useFeedPollInterval();
  const footerInfo = useMemo(
    () => [...accessInfo, ...(info ?? [])],
    [accessInfo, info],
  );
  const trailingInfo = useMemo(
    () => [poll.segment],
    [poll.segment],
  );
  const hints = useMemo<PaneHint[]>(() => (
    onRefresh
      ? [{ id: "refresh", key: "r", label: "efresh", onPress: onRefresh }]
      : []
  ), [onRefresh]);
  const trailingHints = useMemo<PaneHint[]>(() => {
    const trailing: PaneHint[] = [];
    if (onShare && article) {
      trailing.push({ id: "share", key: "y", label: " share", onPress: onShare });
    }
    if (archiveAction.enabled) {
      trailing.push({ id: "archive", key: "a", label: "rchive", onPress: archiveAction.archive });
    }
    if (onPopOut && article) {
      trailing.push({ id: "pop-out", key: "p", label: "op out", onPress: onPopOut });
    }
    return trailing;
  }, [archiveAction.archive, archiveAction.enabled, article, onPopOut, onShare]);

  useShortcut((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    if (!focused) return;
    if (onRefresh && key === "r") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onRefresh();
      return;
    }
    if (onShare && key === "y") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onShare();
      return;
    }
    if (archiveAction.enabled && key === "a") {
      event.stopPropagation?.();
      event.preventDefault?.();
      archiveAction.archive();
      return;
    }
    if (onPopOut && article && key === "p") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onPopOut();
    }
  }, { enabled: focused && (!!onPopOut && !!article || !!onRefresh || !!onShare || archiveAction.enabled) });

  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info: footerInfo,
    trailingInfo,
    hints,
    trailingHints,
    showOpenHint: true,
    loading,
    error,
  });
}
