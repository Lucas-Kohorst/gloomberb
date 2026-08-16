import { useMemo } from "react";
import { useShortcut } from "../../../../../react/input";
import type { PaneFooterSegment, PaneHint } from "../../../../../components";
import { t, tf } from "../../../../../i18n";
import { useAppLanguage } from "../../../../../i18n/react";
import { useCloudAccessFooter } from "../../../shared/cloud-upgrade";
import { CLOUD_NEWS_DELAY_HOURS } from "../../../shared/plan-access";
import { usePaneStatusLinkFooter } from "../../../shared/pane-footer";

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
  const footerInfo = useMemo(() => [...accessInfo, ...(info ?? [])], [accessInfo, info]);
  const hints = useMemo<PaneHint[]>(() => (
    onRefresh
      ? [{ id: "refresh", key: "r", label: "efresh", onPress: onRefresh }]
      : []
  ), [onRefresh]);
  const trailingHints = useMemo<PaneHint[]>(() => {
    const hints: PaneHint[] = [];
    if (onShare && article) {
      hints.push({ id: "share", key: "y", label: " share", onPress: onShare });
    }
    if (onPopOut && article) {
      hints.push({ id: "pop-out", key: "p", label: "op out", onPress: onPopOut });
    }
    return hints;
  }, [article, onPopOut, onShare]);

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
    if (onPopOut && article && key === "p") {
      event.stopPropagation?.();
      event.preventDefault?.();
      onPopOut();
    }
  }, { enabled: focused && (!!onPopOut && !!article || !!onRefresh || !!onShare) });

  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info: footerInfo,
    hints,
    trailingHints,
    showOpenHint: true,
    loading,
    error,
  });
}
