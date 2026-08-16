import type { RssFeedConfig } from "./rss/parser";

export const DEFAULT_FEEDS: RssFeedConfig[] = [
  { id: "cnbc-top-news", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", name: "CNBC Top News", category: "general", authority: 85, enabled: true },
  { id: "cnbc-economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", name: "CNBC Economy", category: "macro", authority: 80, enabled: true },
  { id: "cnbc-business", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", name: "CNBC Business", category: "general", authority: 78, enabled: true },
  { id: "marketwatch-top", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", name: "MarketWatch Top Stories", category: "general", authority: 80, enabled: true },
  { id: "marketwatch-markets", url: "https://feeds.content.dowjones.io/public/rss/mw_markets_main", name: "MarketWatch Markets", category: "finance", authority: 78, enabled: true },
  { id: "seeking-alpha-currents", url: "https://seekingalpha.com/market_currents.xml", name: "Seeking Alpha Market Currents", category: "finance", authority: 70, enabled: true },
  { id: "yahoo-finance", url: "https://finance.yahoo.com/news/rssindex", name: "Yahoo Finance", category: "general", authority: 72, enabled: true },
  { id: "investopedia", url: "https://www.investopedia.com/feed/", name: "Investopedia", category: "finance", authority: 60, enabled: true },
  { id: "motley-fool", url: "https://www.fool.com/feeds/index.aspx", name: "The Motley Fool", category: "general", authority: 55, enabled: true },
  { id: "ft-markets", url: "https://www.ft.com/rss/home", name: "Financial Times", category: "general", authority: 88, enabled: true },
  { id: "barrons", url: "https://www.barrons.com/feed", name: "Barron's", category: "finance", authority: 82, enabled: true },
  { id: "wsj-markets", url: "https://feeds.content.dowjones.io/public/rss/SB10001424053111904110904576566223331193112", name: "WSJ Markets", category: "finance", authority: 85, enabled: true },
  { id: "reuters-world", url: "https://www.reuters.com/arc/outboundfeeds/rss/?outputType=xml", name: "Reuters World", category: "general", authority: 85, enabled: true },
  { id: "cnbc-tech", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001689", name: "CNBC Technology", category: "tech", authority: 75, enabled: true },
  { id: "cnbc-energy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=48333730", name: "CNBC Energy", category: "energy", authority: 75, enabled: true },
  { id: "cnbc-healthcare", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000739", name: "CNBC Healthcare", category: "healthcare", authority: 75, enabled: true },
];
