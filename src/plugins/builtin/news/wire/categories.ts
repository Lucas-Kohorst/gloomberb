import { extractArticleTickers, type ArticleTickerContext } from "../../../../news/article-tickers";
import type { MarketNewsItem } from "../../../../types/news-source";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  tech: ["ai", "chip", "semiconductor", "software", "cloud", "cyber", "apple", "google", "microsoft", "meta", "nvidia", "amazon", "saas", "startup"],
  energy: ["oil", "gas", "crude", "opec", "refinery", "solar", "wind", "pipeline", "lng", "drilling"],
  finance: ["bank", "rate", "fed", "fomc", "treasury", "yield", "credit", "loan", "mortgage", "ipo"],
  healthcare: ["pharma", "drug", "fda", "biotech", "vaccine", "hospital", "medicare"],
  macro: ["gdp", "cpi", "inflation", "jobs", "unemployment", "trade", "tariff", "deficit", "pmi"],
  earnings: ["earnings", "revenue", "eps", "beat", "miss", "guidance", "outlook", "quarterly"],
  crypto: ["bitcoin", "ethereum", "crypto", "blockchain", "token", "defi", "mining"],
  geopolitical: ["war", "sanctions", "nato", "military", "conflict", "diplomacy"],
};

function classifyArticle(item: MarketNewsItem): string[] {
  const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const matched: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        matched.push(category);
        break;
      }
    }
  }

  return matched;
}

const BREAKING_PATTERNS = [
  /\bbreaking\b/i,
  /\bjust in\b/i,
  /\bflash\b/i,
  /\balert\b/i,
  /\burgent\b/i,
];

function detectBreaking(title: string, publishedAt: Date, authority: number): boolean {
  for (const re of BREAKING_PATTERNS) {
    if (re.test(title)) return true;
  }

  const ageMs = Date.now() - publishedAt.getTime();
  if (authority >= 70 && ageMs < 10 * 60 * 1000) return true;

  return false;
}

function scoreImportance(authority: number, publishedAt: Date, isBreaking: boolean): number {
  const ageMs = Date.now() - publishedAt.getTime();
  let score = authority;

  if (ageMs < 30 * 60 * 1000) score += 20;
  else if (ageMs < 2 * 60 * 60 * 1000) score += 10;

  if (isBreaking) score += 30;

  return Math.min(100, score);
}

export function enrichNewsItem(
  item: MarketNewsItem,
  authority = 50,
  knownTickers?: ArticleTickerContext | Set<string>,
): MarketNewsItem {
  const categories = item.categories.length > 0
    ? [...new Set([...item.categories, ...classifyArticle(item)])]
    : classifyArticle(item);

  const context: ArticleTickerContext | undefined = knownTickers instanceof Set
    ? { symbols: knownTickers }
    : knownTickers;
  const text = [item.title, item.summary, item.body, ...item.categories].filter(Boolean).join(" ");
  const tickers = [
    ...new Set([
      ...item.tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean),
      ...extractArticleTickers(text, context),
    ]),
  ];
  const isBreaking = detectBreaking(item.title, item.publishedAt, authority);
  const importance = scoreImportance(authority, item.publishedAt, isBreaking);
  const topic = categories[0] ?? item.topic ?? "general";
  const scores = {
    importance,
    urgency: isBreaking ? 80 : Math.min(100, Math.max(0, importance - 10)),
    marketImpact: importance,
    novelty: item.scores?.novelty ?? 0,
    confidence: item.scores?.confidence ?? 0,
  };

  return {
    ...item,
    topic,
    topics: [...new Set([topic, ...(item.topics ?? []), ...categories])],
    sectors: item.sectors ?? [],
    categories,
    tickers,
    scores,
    isBreaking,
    isDeveloping: item.isDeveloping ?? false,
    importance,
  };
}
