import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "../../../ui";
import { EmptyState, Spinner, type PaneHint } from "../../../components";
import { usePaneSettingValue } from "../../../state/app/context";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import type { PaneProps } from "../../../types/plugin";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { useCopyShareLink, substackArticleSharePayload } from "../shared/article-share";
import { substackReaderBody } from "./content";
import { loadSubstackArticleDetail } from "./api/loaders";
import { SubstackAuthError } from "./api/types";
import { getStashedSubstackArticle } from "./article-stash";
import { emptyLoadState, errorMessage, type DetailState } from "./pane-state";
import type { SubstackArticleDetail, SubstackArticleSummary } from "./types";
import { JinaArticleReader, useJinaArticle } from "../shared/jina-reader";

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
  const [articleId] = usePaneSettingValue("articleId", "");
  const [title] = usePaneSettingValue("title", "Article");
  const [url] = usePaneSettingValue("url", "");
  const [article, setArticle] = useState<SubstackArticleSummary | null>(() => (
    (articleId ? getStashedSubstackArticle(articleId) : null)
    ?? summaryFromSettings(articleId, title, url)
  ));
  const [detail, setDetail] = useState<DetailState>(emptyLoadState<SubstackArticleDetail>());
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

  const copyShareLink = useCopyShareLink();
  const shareArticle = useCallback(() => {
    if (!article) return;
    const cached = detail.data;
    void (async () => {
      if (cached?.bodyHtml || cached?.contentText) {
        await copyShareLink(substackArticleSharePayload(article, cached));
        return;
      }
      try {
        const entry = await loadSubstackArticleDetail(article);
        await copyShareLink(substackArticleSharePayload(article, entry.data));
      } catch {
        await copyShareLink(substackArticleSharePayload(article));
      }
    })();
  }, [article, copyShareLink, detail.data]);

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
  const knownBody = substackReaderBody(article, detail.data);
  const skipJina = knownBody.length >= 400 || knownBody.includes("\n\n");
  const jina = useJinaArticle(article?.url ?? url, !!(article?.url ?? url) && !skipJina);

  usePaneStatusLinkFooter({
    registrationId: "substack-article-reader",
    focused,
    url: article?.url ?? url,
    source: article?.publicationName,
    label: "article",
    loading: (!skipJina && jina.loading) || (detail.loading && !knownBody),
    error: detail.error ?? jina.error,
    hints: article
      ? [{
        id: "refresh",
        key: "r",
        label: "efresh",
        onPress: skipJina ? () => loadDetail(article, true) : jina.refresh,
      }]
      : [],
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

  if (detail.loading && !detail.data && !knownBody) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading article..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <JinaArticleReader
        title={article.title}
        url={article.url ?? url}
        width={width}
        height={height}
        focused={focused}
        state={jina}
        knownBody={knownBody}
      />
    </Box>
  );
}
