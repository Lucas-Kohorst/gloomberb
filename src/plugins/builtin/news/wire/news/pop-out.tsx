import { useCallback, useEffect, useState } from "react";
import type { NewsArticle } from "../../../../../news/types";
import { mergeNewsArticle } from "../../../../../news/news-model";
import { useLoadNewsStory } from "../../../../../news/hooks";
import { PaneStatusBody } from "../../../../../components";
import { usePaneInstance } from "../../../../../state/app/context";
import type { PaneProps, PaneTemplateCreateOptions, PaneTemplateDef } from "../../../../../types/plugin";
import { usePluginAppActions } from "../../../../runtime";
import { NewsDetailView } from "./detail-view";
import { useNewsArticleFooter } from "./footer";

export const NEWS_STORY_PANE_ID = "news-story";
const NEWS_STORY_TEMPLATE_ID = "news-story-pane";

const shownStories = new Map<string, NewsArticle>();

function rememberNewsStory(article: NewsArticle): void {
  shownStories.set(article.id, article);
}

function shownStory(articleId: string): NewsArticle | null {
  if (!articleId) return null;
  return shownStories.get(articleId) ?? null;
}

export const openNewsStoryPane = (
  article: NewsArticle,
  createPaneFromTemplate: (templateId: string, options?: PaneTemplateCreateOptions) => void,
): void => {
  rememberNewsStory(article);
  createPaneFromTemplate(NEWS_STORY_TEMPLATE_ID, {
    arg: article.id,
    values: { title: article.title },
  });
};

export function usePopOutNewsArticle(onReturnedToList?: () => void) {
  const { createPaneFromTemplate } = usePluginAppActions();

  return useCallback((article: NewsArticle | null | undefined) => {
    if (!article) return;
    openNewsStoryPane(article, createPaneFromTemplate);
    onReturnedToList?.();
  }, [createPaneFromTemplate, onReturnedToList]);
}

export function createNewsStoryPaneTemplate(): PaneTemplateDef {
  return {
    id: NEWS_STORY_TEMPLATE_ID,
    paneId: NEWS_STORY_PANE_ID,
    label: "Story",
    description: "One news story in its own pane.",
    canCreate: (_context, options) => !!options?.arg?.trim(),
    createInstance: (_context, options) => {
      const articleId = options?.arg?.trim() ?? "";
      if (!articleId) return null;
      return {
        title: options?.values?.title?.trim() || "Story",
        params: { articleId },
        placement: "floating",
      };
    },
  };
}

export function NewsStoryPane({ focused, width }: PaneProps) {
  const articleId = usePaneInstance()?.params?.articleId ?? "";
  const loadNewsStory = useLoadNewsStory();
  const [article, setArticle] = useState<NewsArticle | null>(() => shownStory(articleId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const known = shownStory(articleId);
    setArticle(known);
    setError(null);
    if (!articleId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void loadNewsStory(articleId)
      .then((loaded) => {
        if (!active) return;
        if (loaded) {
          setArticle((current) => {
            if (current && current.id === loaded.id) return mergeNewsArticle(current, loaded);
            return loaded;
          });
          setError(null);
        } else if (!known) {
          setError("Story detail unavailable.");
        }
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (!known) {
          setError(cause instanceof Error ? cause.message : "Story detail unavailable.");
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [articleId, loadNewsStory]);

  useNewsArticleFooter({
    registrationId: "news-story",
    focused,
    article,
    loading: loading && !article,
    error: article ? null : error,
  });

  if (!articleId) {
    return (
      <PaneStatusBody
        empty
        subject="Story"
        emptyTitle="No story open."
        emptyMessage="Open one from a news list."
      />
    );
  }
  if (!article) {
    return (
      <PaneStatusBody
        loading={loading}
        error={error}
        empty={!loading && !error}
        subject="Story"
        emptyTitle="Story unavailable."
        emptyMessage="Open it again from the list."
      />
    );
  }
  return (
    <NewsDetailView
      item={article}
      focused={focused}
      width={width}
      showTitle={false}
    />
  );
}
