import { useCallback } from "react";
import type { NewsArticle } from "../../../../../news/types";
import { usePluginAppActions } from "../../../../runtime";
import { NEWS_ARTICLE_READER_TEMPLATE_ID } from "../../../shared/article-pop-out";
import { stashNewsArticle } from "./article-stash";

export function usePopOutNewsArticle(onReturnedToList?: () => void) {
  const { createPaneFromTemplate } = usePluginAppActions();

  return useCallback((article: NewsArticle | null | undefined) => {
    if (!article) return;
    stashNewsArticle(article);
    createPaneFromTemplate(NEWS_ARTICLE_READER_TEMPLATE_ID, {
      arg: article.id,
      values: {
        title: article.title,
        url: article.url,
        source: article.source,
      },
    });
    onReturnedToList?.();
  }, [createPaneFromTemplate, onReturnedToList]);
}
