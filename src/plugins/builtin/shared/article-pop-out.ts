export const ARTICLE_READER_FLOATING_SIZE = { width: 110, height: 38 } as const;

export const NEWS_ARTICLE_READER_PANE_ID = "news-article";
export const NEWS_ARTICLE_READER_TEMPLATE_ID = "news-article-pane";
export const SUBSTACK_ARTICLE_READER_PANE_ID = "substack-article";
export const SUBSTACK_ARTICLE_READER_TEMPLATE_ID = "substack-article-pane";
export const TWEET_READER_PANE_ID = "x-tweet";
export const TWEET_READER_TEMPLATE_ID = "x-tweet-pane";

export function articleReaderInstanceId(paneId: string, articleId: string): string {
  return `${paneId}:${encodeURIComponent(articleId).replace(/%/g, "~")}`;
}
