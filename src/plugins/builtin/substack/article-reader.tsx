import { useCallback, useEffect, useRef, useState } from "react";
import { Box, type ScrollBoxRenderable, useRendererHost } from "../../../ui";
import { EmptyState, Spinner, type PaneHint } from "../../../components";
import { usePaneSettingValue } from "../../../state/app/context";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useCopyShareLink, encodeSubstackArticleForShare } from "../shared/article-share";
import { loadSubstackArticleDetail } from "./api/loaders";
import { SubstackAuthError } from "./api/types";
import { ArticleDetail } from "./article-detail";
import { getStashedSubstackArticle } from "./article-stash";
import { emptyLoadState, errorMessage, type DetailState } from "./pane-state";
import type { SubstackArticleDetail, SubstackArticleSummary } from "./types";

function summaryFromSettings(
  articleId: string,
  title: string,
  url: string,
): SubstackArticleSummary | null {
  if (!articleId) return null;
  return {
    id: articleId,
    title: title || "Article",
    publicationId: null,
    publicationName: null,
    publicationSubdomain: null,
    publicationBaseUrl: null,
    url: url || null,
    slug: null,
    publishedAt: null,
    subtitle: null,
    previewText: null,
    bodyHtml: null,
    imageUrls: [],
    wordCount: 0,
    readMinutes: 0,
  };
}

export function SubstackArticleReaderPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const [articleId] = usePaneSettingValue("articleId", "");
  const [title] = usePaneSettingValue("title", "Article");
  const [url] = usePaneSettingValue("url", "");
  const [article, setArticle] = useState<SubstackArticleSummary | null>(() => (
    (articleId ? getStashedSubstackArticle(articleId) : null)
    ?? summaryFromSettings(articleId, title, url)
  ));
  const [detail, setDetail] = useState<DetailState>(emptyLoadState<SubstackArticleDetail>());
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const fetchGenRef = useRef(0);

  const loadDetail = useCallback((target: SubstackArticleSummary, force = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setDetail((current) => ({ ...current, loading: true, error: null }));
    loadSubstackArticleDetail(target, force)
      .then((entry) => {
        if (fetchGenRef.current !== gen) return;
        setDetail({
          data: entry.data,
          loading: false,
          error: null,
          fetchedAt: entry.fetchedAt,
          stale: entry.stale,
        });
      })
      .catch((error) => {
        if (fetchGenRef.current !== gen) return;
        setDetail((current) => ({
          ...current,
          loading: false,
          error: error instanceof SubstackAuthError
            ? error.message
            : errorMessage(error),
        }));
      });
  }, []);

  useEffect(() => {
    const next = (articleId ? getStashedSubstackArticle(articleId) : null)
      ?? summaryFromSettings(articleId, title, url);
    setArticle(next);
    if (!next) {
      setDetail(emptyLoadState<SubstackArticleDetail>());
      return;
    }
    loadDetail(next, false);
  }, [articleId, loadDetail, title, url]);

  const openSelectedArticle = useCallback(() => {
    const href = article?.url ?? url;
    if (!href) return;
    void rendererHost.openExternal(href);
  }, [article?.url, rendererHost, url]);

  const copyShareLink = useCopyShareLink();
  const shareArticle = useCallback(() => {
    if (!article) return;
    void copyShareLink(encodeSubstackArticleForShare(article));
  }, [article, copyShareLink]);

  useShortcut((event) => {
    if (!focused || !article) return;
    if (isPlainKey(event, "y")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      shareArticle();
    }
  }, { enabled: focused && !!article });

  const shareHint: PaneHint[] = article
    ? [{ id: "share", key: "y", label: " share", onPress: shareArticle }]
    : [];

  usePaneStatusLinkFooter({
    registrationId: "substack-article-reader",
    focused,
    url: article?.url ?? url,
    source: article?.publicationName,
    label: "article",
    loading: detail.loading,
    error: detail.error,
    showOpenHint: true,
    trailingHints: shareHint,
  });

  if (!article) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        <EmptyState title="Article unavailable." hint={url ? "Press o to open the source." : undefined} />
      </Box>
    );
  }

  if (detail.loading && !detail.data) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading article..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ArticleDetail
        article={article}
        detail={detail.data}
        width={width}
        loading={detail.loading}
        error={detail.error}
        scrollRef={scrollRef}
        onOpenArticle={openSelectedArticle}
      />
    </Box>
  );
}
