import { useEffect, useMemo, useState } from "react";
import { Box } from "../../../../../ui";
import { EmptyState, Spinner } from "../../../../../components";
import { useLoadNewsStory } from "../../../../../news/hooks";
import { usePaneSettingValue } from "../../../../../state/app/context";
import type { NewsArticle } from "../../../../../news/types";
import type { PaneProps } from "../../../../../types/plugin";
import { useNewsArticleFooter } from "./footer";
import { getStashedNewsArticle } from "./article-stash";
import { useCopyShareLink, encodeNewsArticleForShare } from "../../../shared/article-share";
import { JinaArticleReader, useJinaArticle } from "../../../shared/jina-reader";

export function NewsArticleReaderPane({ focused, width, height }: PaneProps) {
  const [articleId] = usePaneSettingValue("articleId", "");
  const [title] = usePaneSettingValue("title", "Article");
  const [url] = usePaneSettingValue("url", "");
  const [source] = usePaneSettingValue("source", "");
  const loadNewsStory = useLoadNewsStory();
  const [article, setArticle] = useState<NewsArticle | null>(() => (
    articleId ? getStashedNewsArticle(articleId) : null
  ));
  const [loading, setLoading] = useState(!article && !!articleId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!articleId) {
      setArticle(null);
      setLoading(false);
      return;
    }
    const stashed = getStashedNewsArticle(articleId);
    if (stashed) {
      setArticle(stashed);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadNewsStory(articleId)
      .then((loaded) => {
        if (cancelled) return;
        setArticle(loaded);
        setLoading(false);
        if (!loaded) setError("Article is no longer available.");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [articleId, loadNewsStory]);

  const footerArticle = useMemo(() => (
    article ?? (url ? { source: source || undefined, url } : null)
  ), [article, source, url]);

  const copyShareLink = useCopyShareLink();
  const shareArticle = article
    ? () => copyShareLink(encodeNewsArticleForShare(article))
    : undefined;
  const jina = useJinaArticle(article?.url ?? url, !!(article?.url ?? url));

  useNewsArticleFooter({
    registrationId: "news-article-reader",
    focused,
    article: footerArticle,
    loading: loading || jina.loading,
    error: error ?? jina.error,
    onRefresh: jina.refresh,
    onShare: shareArticle,
  });

  if (loading && !article) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading article..." />
      </Box>
    );
  }

  if (!article) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        <EmptyState
          title={title || "Article unavailable."}
          message={error ?? "This popped-out article is no longer in memory."}
          hint={url ? "Press o to open the source." : undefined}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <JinaArticleReader
        title={article.title}
        url={article.url}
        width={width}
        height={height}
        focused={focused}
        state={jina}
      />
    </Box>
  );
}
