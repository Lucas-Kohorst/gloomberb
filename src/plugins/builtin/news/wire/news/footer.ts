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
  onRefresh?: () => void;
}

export function useNewsArticleFooter({
  registrationId,
  focused,
  article,
  info,
  loading = false,
  error,
  onRefresh,
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

  useShortcut((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    if (!focused || !onRefresh || key !== "r") return;
    event.stopPropagation?.();
    event.preventDefault?.();
    onRefresh();
  }, { enabled: focused && !!onRefresh });

  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info: footerInfo,
    hints,
    showOpenHint: true,
    loading,
    error,
  });
}
