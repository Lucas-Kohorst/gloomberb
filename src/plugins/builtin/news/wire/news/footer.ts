import { useCallback, useMemo } from "react";
import type { PaneFooterSegment, PaneHint } from "../../../../../components";
import { useUpdatedAgo } from "../../../../../components";
import { t, tf } from "../../../../../i18n";
import { useAppLanguage } from "../../../../../i18n/react";
import { useShortcut } from "../../../../../react/input";
import { useUiCapabilities } from "../../../../../ui";
import { isPlainKey } from "../../../../../utils/keyboard";
import { useCloudAccessFooter } from "../../../shared/cloud-upgrade";
import { CLOUD_NEWS_DELAY_HOURS } from "../../../shared/plan-access";
import { usePaneStatusLinkFooter } from "../../../shared/pane-footer";
import { usePublicShare } from "../../../shared/public-share";
import { pollFooterTrailingInfo, useFeedPollInterval } from "../../../shared/feed-poll-interval";
import { useArticleArchiveAction } from "../../../shared/article-archive";
import { usePluginAppActions } from "../../../../runtime";
import { NEWS_SAVED_PANE_TEMPLATE_ID } from "../saved-state";

interface NewsFooterArticle {
  id?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  url?: string | null;
  items?: Array<{ title?: string | null; summary?: string | null }>;
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
  onRead?: () => void;
  /** Toggles the save-for-later bookmark on the readable article ([b]ookmark). */
  onBookmark?: (articleId: string) => void;
  /** Bookmark count; gates the [v]iew saved deep link to the Saved News pane. */
  savedCount?: number;
  /** Feed lists poll. Article readers / open article details do not. */
  showPoll?: boolean;
  /** Last successful fetch; shown as "updated Xm ago" next to the poll chip. */
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
  onRefresh,
  onShare,
  onRead,
  onBookmark,
  savedCount,
  showPoll = true,
  updatedAt,
}: UseNewsArticleFooterOptions) {
  const language = useAppLanguage();
  const { createPaneFromTemplate } = usePluginAppActions();
  const updatedAgo = useUpdatedAgo(updatedAt);
  const archiveAction = useArticleArchiveAction(article?.url);
  const { publicSharing } = useUiCapabilities();
  const createPublicShare = usePublicShare();
  const shareArticle = useCallback(() => {
    if (!article?.title) return;
    const text = [
      article.summary,
      article.title,
      ...(article.items ?? []).map((item) => item.summary || item.title),
    ].filter((value): value is string => !!value?.trim()).join("\n\n").slice(0, 50_000);
    void createPublicShare({
      kind: "article",
      data: {
        title: article.title,
        text,
        ...(article.url ? { sourceUrl: article.url } : {}),
      },
    });
  }, [article, createPublicShare]);
  useShortcut((event) => {
    if (onShare || !focused || !publicSharing || !article?.title || !isPlainKey(event, "y")) return;
    event.preventDefault();
    event.stopPropagation();
    shareArticle();
  });
  const { access, segment } = useCloudAccessFooter({
    delayLabel: tf("{count}h", { count: CLOUD_NEWS_DELAY_HOURS }),
    focused,
    segmentId: "news-access",
    shortcutScope: `${registrationId}:news-upgrade`,
  });

  const accessInfo = useMemo<PaneFooterSegment[]>(() => {
    if (access.hasProAccess) {
      return [{ id: "news-access", parts: [{ text: t("real-time news"), tone: "positive" }] }];
    }
    return segment ? [segment] : [];
  }, [access.hasProAccess, language, segment]);
  const poll = useFeedPollInterval();
  const footerInfo = useMemo(
    () => [
      ...accessInfo,
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
      ...(info ?? []),
    ],
    [accessInfo, info, updatedAgo],
  );
  const trailingInfo = useMemo(
    () => pollFooterTrailingInfo(showPoll, poll.segment),
    [poll.segment, showPoll],
  );
  const trailingHints = useMemo<PaneHint[]>(() => {
    const trailing: PaneHint[] = [];
    const bookmarkArticleId = typeof article?.id === "string" ? article.id : null;
    if (onBookmark && bookmarkArticleId) {
      trailing.push({
        id: "bookmark",
        key: "b",
        label: "ookmark",
        onPress: () => onBookmark(bookmarkArticleId),
      });
    }
    if ((savedCount ?? 0) > 0) {
      trailing.push({
        id: "view-saved",
        key: "v",
        label: "iew saved",
        onPress: () => createPaneFromTemplate(NEWS_SAVED_PANE_TEMPLATE_ID),
      });
    }
    if (onShare && article) {
      trailing.push({ id: "share", key: "s", label: "hare", onPress: onShare });
    }
    if (archiveAction.enabled) {
      trailing.push({ id: "archive", key: "a", label: "rchive", onPress: archiveAction.archive });
    }
    if (onPopOut && article) {
      trailing.push({
        id: "pop-out",
        key: "p",
        label: "op out",
        onPress: () => {
          onRead?.();
          onPopOut();
        },
      });
    }
    return trailing;
  }, [archiveAction.archive, archiveAction.enabled, article, createPaneFromTemplate, onBookmark, onPopOut, onRead, onShare, savedCount]);

  useShortcut((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    if (!focused) return;
    if (onRefresh && key === "r") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onRefresh();
      return;
    }
    if (onShare && (key === "s" || key === "y")) {
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
      onRead?.();
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
    trailingHints,
    showOpenHint: true,
    loading,
    error,
    onOpen: onRead,
  });
}
