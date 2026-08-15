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
}

export function useNewsArticleFooter({
  registrationId,
  focused,
  article,
  info,
  loading = false,
  error,
  onPopOut,
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
  const trailingHints = useMemo<PaneHint[]>(() => (
    onPopOut && article
      ? [{ id: "pop-out", key: "p", label: "op out", onPress: onPopOut }]
      : []
  ), [article, onPopOut]);

  useShortcut((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    if (!focused || !onPopOut || !article || key !== "p") return;
    event.stopPropagation?.();
    event.preventDefault?.();
    onPopOut();
  }, { enabled: focused && !!onPopOut && !!article });

  usePaneStatusLinkFooter({
    registrationId,
    focused,
    url: article?.url,
    source: article?.source,
    info: footerInfo,
    trailingHints,
    showOpenHint: true,
    loading,
    error,
  });
}
