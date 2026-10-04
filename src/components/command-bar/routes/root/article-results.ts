import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { SecFilingItem } from "../../../../types/data-provider";
import type { NewsArticle } from "../../../../news/types";
import { getSharedNewsService } from "../../../../news/hooks";
import { SecEdgarClient } from "../../../../sources/sec-edgar";
import type { ResultItem } from "../../list/model";

const MIN_CORPUS_QUERY_LENGTH = 3;
const ARTICLE_LIMIT = 8;
const FILING_LIMIT = 5;
const ARTICLE_POOL_LIMIT = 200;
const EMPTY_ARTICLES: readonly NewsArticle[] = [];
const EMPTY_FILINGS: readonly SecFilingItem[] = [];

const TICKER_TOKEN = /^[A-Za-z][A-Za-z0-9.-]{0,4}$/;
const FILING_QUERY = /\b(?:10-?k|10-?q|8-?k|filings?|edgar)\b/i;
const FILING_NOISE = new Set([
  "10k",
  "10q",
  "8k",
  "10ka",
  "10qa",
  "8ka",
  "filing",
  "filings",
  "edgar",
  "article",
  "articles",
  "news",
]);

const edgar = new SecEdgarClient();
const filingCache = new Map<string, SecFilingItem[]>();
let articleWarm: Promise<void> | null = null;

const shouldSearchWrittenCorpus = (query: string): boolean => (
  query.trim().length >= MIN_CORPUS_QUERY_LENGTH
);

const corpusTokens = (query: string): string[] => (
  query.trim().toLowerCase().split(/\s+/).filter((token) => token.length >= MIN_CORPUS_QUERY_LENGTH)
);

const articleHaystack = (article: NewsArticle): string => [
  article.title,
  article.source,
  article.summary ?? "",
  ...article.tickers,
  ...article.topics,
  ...article.categories,
].join(" ").toLowerCase();

const filingSearchTicker = (query: string): string | null => {
  const trimmed = query.trim();
  if (!shouldSearchWrittenCorpus(trimmed)) return null;
  if (TICKER_TOKEN.test(trimmed)) return trimmed.toUpperCase();
  if (!FILING_QUERY.test(trimmed)) return null;
  const stripped = trimmed.replace(/\b(?:10-?k\/?a?|10-?q\/?a?|8-?k\/?a?|filings?|edgar)\b/gi, " ");
  const tokens = stripped.split(/\s+/).filter((token) => TICKER_TOKEN.test(token));
  const token = tokens.length === 1 ? tokens[0] : null;
  return token ? token.toUpperCase() : null;
};

const wantedForm = (query: string): string | null => {
  if (/\b10-?k\b/i.test(query)) return "10K";
  if (/\b10-?q\b/i.test(query)) return "10Q";
  if (/\b8-?k\b/i.test(query)) return "8K";
  return null;
};

const compactForm = (form: string): string => form.toUpperCase().replace(/[^A-Z0-9]/g, "");

const filingBadge = (form: string): string => {
  const compact = form.toUpperCase().replace(/\s+/g, "");
  return compact.length <= 6 ? compact : compact.slice(0, 6);
};

const searchArticles = (articles: readonly NewsArticle[], query: string): NewsArticle[] => {
  const tokens = corpusTokens(query);
  if (!shouldSearchWrittenCorpus(query) || tokens.length === 0) return [];
  return articles
    .filter((article) => {
      const haystack = articleHaystack(article);
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
    .slice(0, ARTICLE_LIMIT);
};

const searchFilings = (
  filings: readonly SecFilingItem[],
  query: string,
  ticker: string | null,
): SecFilingItem[] => {
  if (!ticker || !shouldSearchWrittenCorpus(query)) return [];
  const form = wantedForm(query);
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => (
    token.length >= MIN_CORPUS_QUERY_LENGTH
    && !FILING_NOISE.has(token)
    && token !== ticker.toLowerCase()
  ));
  return filings.filter((filing) => {
    if (form && !compactForm(filing.form).startsWith(form)) return false;
    if (tokens.length === 0) return true;
    const haystack = [
      filing.form,
      filing.companyName ?? "",
      filing.primaryDocDescription ?? "",
      filing.items ?? "",
      filing.accessionNumber,
      ticker,
    ].join(" ").toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, FILING_LIMIT);
};

export const buildCorpusResultItems = (options: {
  query: string;
  articles?: readonly NewsArticle[];
  filings?: readonly SecFilingItem[];
  filingTicker?: string | null;
  onOpenArticle?: (article: NewsArticle) => void;
  onOpenFiling?: (filing: SecFilingItem, ticker: string) => void;
}): ResultItem[] => {
  const query = options.query.trim();
  if (!shouldSearchWrittenCorpus(query)) return [];
  const ticker = options.filingTicker ?? filingSearchTicker(query);
  const articles = searchArticles(options.articles ?? [], query).map((article): ResultItem => ({
    id: `article:${article.id}`,
    label: article.title,
    detail: article.source,
    category: "Articles",
    kind: "action",
    badge: "NEWS",
    searchText: articleHaystack(article),
    action: () => options.onOpenArticle?.(article),
  }));
  const filings = searchFilings(options.filings ?? [], query, ticker).map((filing): ResultItem => ({
    id: `filing:${filing.accessionNumber}`,
    label: `${filing.form} ${filing.companyName || ticker || ""}`.trim(),
    detail: filing.filingDate.toISOString().slice(0, 10),
    category: "Filings",
    kind: "action",
    badge: filingBadge(filing.form),
    searchText: [filing.form, filing.companyName ?? "", filing.primaryDocDescription ?? "", ticker ?? ""].join(" "),
    action: () => {
      if (ticker) options.onOpenFiling?.(filing, ticker);
    },
  }));
  return [...articles, ...filings];
};

const warmArticlePool = (): void => {
  if (process.env.NODE_ENV === "test") return;
  const service = getSharedNewsService();
  if (!service || service.listArticles().length > 0 || articleWarm) return;
  articleWarm = service.load({ feed: "latest", limit: ARTICLE_POOL_LIMIT }).then(() => {}).catch(() => {}).finally(() => {
    articleWarm = null;
  });
};

const loadRecentFilings = async (ticker: string): Promise<SecFilingItem[]> => {
  const cached = filingCache.get(ticker);
  if (cached) return cached;
  const filings = await edgar.getRecentFilings(ticker);
  filingCache.set(ticker, filings);
  return filings;
};

export const useCommandBarCorpus = (query: string, enabled: boolean): {
  articles: readonly NewsArticle[];
  filings: readonly SecFilingItem[];
  filingTicker: string | null;
} => {
  const service = getSharedNewsService();
  const articles = useSyncExternalStore(
    useCallback((listener: () => void) => {
      if (!enabled || !service) return () => {};
      return service.subscribe(listener);
    }, [enabled, service]),
    useCallback(() => (enabled && service ? service.listArticles() : EMPTY_ARTICLES), [enabled, service]),
    useCallback(() => EMPTY_ARTICLES, []),
  );
  const [filings, setFilings] = useState<readonly SecFilingItem[]>(EMPTY_FILINGS);
  const [filingTicker, setFilingTicker] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    warmArticlePool();
  }, [enabled]);

  useEffect(() => {
    const ticker = enabled ? filingSearchTicker(query) : null;
    setFilingTicker(ticker);
    if (!ticker || process.env.NODE_ENV === "test") {
      setFilings(EMPTY_FILINGS);
      return;
    }
    let cancelled = false;
    setFilings(filingCache.get(ticker) ?? EMPTY_FILINGS);
    void loadRecentFilings(ticker).then((found) => {
      if (!cancelled) setFilings(found);
    }).catch(() => {
      if (!cancelled) setFilings(EMPTY_FILINGS);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, query]);

  return { articles, filings, filingTicker };
};
