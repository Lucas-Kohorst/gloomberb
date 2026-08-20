import type { RssFeedConfig } from "./rss/parser";

// Default wire is the Jina-readable subset of the expanded RSS list, plus
// feeds whose RSS already carries a full content:encoded body. Publishers
// that only return 403/paywall/boilerplate (Investing.com, NYT, WSJ, …) are
// omitted; user-added feeds and per-feed disable settings are unchanged.
// Adjacent Press is always included.
//
// Invariants (enforced by default-feeds.test.ts): unique ids, http(s) urls,
// authority in 0-100.
export const DEFAULT_FEEDS: RssFeedConfig[] = [

  // -- Wires & national general news ----------------------------------------
  { id: "adjacent-press", url: "https://adjacent.markets/press/rss", name: "Adjacent Press", category: "general", authority: 82, enabled: true },
  { id: "bbc-business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business", category: "general", authority: 80, enabled: true },
  { id: "bbc-world", url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World", category: "general", authority: 80, enabled: true },
  { id: "bbc-tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", name: "BBC Technology", category: "tech", authority: 74, enabled: true },
  { id: "bbc-science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", name: "BBC Science & Environment", category: "general", authority: 72, enabled: true },
  { id: "bbc-politics", url: "https://feeds.bbci.co.uk/news/politics/rss.xml", name: "BBC Politics", category: "geopolitical", authority: 74, enabled: true },
  { id: "guardian-business", url: "https://www.theguardian.com/uk/business/rss", name: "The Guardian Business", category: "general", authority: 76, enabled: true },
  { id: "guardian-economics", url: "https://www.theguardian.com/business/economics/rss", name: "The Guardian Economics", category: "macro", authority: 74, enabled: true },
  { id: "guardian-world", url: "https://www.theguardian.com/world/rss", name: "The Guardian World", category: "general", authority: 76, enabled: true },
  { id: "guardian-tech", url: "https://www.theguardian.com/uk/technology/rss", name: "The Guardian Technology", category: "tech", authority: 70, enabled: true },
  { id: "guardian-money", url: "https://www.theguardian.com/money/rss", name: "The Guardian Money", category: "finance", authority: 66, enabled: true },
  { id: "guardian-us", url: "https://www.theguardian.com/us-news/rss", name: "The Guardian US", category: "general", authority: 72, enabled: true },
  { id: "npr-news", url: "https://feeds.npr.org/1001/rss.xml", name: "NPR News", category: "general", authority: 78, enabled: true },
  { id: "npr-business", url: "https://feeds.npr.org/1006/rss.xml", name: "NPR Business", category: "general", authority: 76, enabled: true },
  { id: "npr-economy", url: "https://feeds.npr.org/1017/rss.xml", name: "NPR Economy", category: "macro", authority: 76, enabled: true },
  { id: "npr-tech", url: "https://feeds.npr.org/1019/rss.xml", name: "NPR Technology", category: "tech", authority: 70, enabled: true },
  { id: "aljazeera-all", url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera", category: "general", authority: 74, enabled: true },
  { id: "cbc-business", url: "https://www.cbc.ca/webfeed/rss/rss-business", name: "CBC Business", category: "general", authority: 72, enabled: true },
  { id: "cbc-world", url: "https://www.cbc.ca/webfeed/rss/rss-world", name: "CBC World", category: "general", authority: 72, enabled: true },
  { id: "france24-business", url: "https://www.france24.com/en/business/rss", name: "France 24 Business", category: "general", authority: 70, enabled: true },
  { id: "abc-au-business", url: "https://www.abc.net.au/news/feed/51892/rss.xml", name: "ABC Australia Business", category: "general", authority: 70, enabled: true },
  { id: "japan-times", url: "https://www.japantimes.co.jp/feed/", name: "The Japan Times", category: "general", authority: 70, enabled: true },

  // -- CNBC sections --------------------------------------------------------
  { id: "cnbc-top-news", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", name: "CNBC Top News", category: "general", authority: 85, enabled: true },
  { id: "cnbc-economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", name: "CNBC Economy", category: "macro", authority: 80, enabled: true },
  { id: "cnbc-business", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", name: "CNBC Business", category: "general", authority: 78, enabled: true },
  { id: "cnbc-markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", name: "CNBC Markets", category: "finance", authority: 80, enabled: true },
  { id: "cnbc-finance", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", name: "CNBC Finance", category: "finance", authority: 76, enabled: true },
  { id: "cnbc-healthcare", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000739", name: "CNBC Healthcare", category: "healthcare", authority: 75, enabled: true },

  // -- Financial Times ------------------------------------------------------
  { id: "ft-home", url: "https://www.ft.com/rss/home", name: "Financial Times", category: "general", authority: 88, enabled: true },
  { id: "ft-companies", url: "https://www.ft.com/companies?format=rss", name: "FT Companies", category: "finance", authority: 84, enabled: true },
  { id: "ft-markets", url: "https://www.ft.com/markets?format=rss", name: "FT Markets", category: "finance", authority: 84, enabled: true },
  { id: "ft-world", url: "https://www.ft.com/world?format=rss", name: "FT World", category: "general", authority: 84, enabled: true },
  { id: "ft-tech", url: "https://www.ft.com/technology?format=rss", name: "FT Technology", category: "tech", authority: 82, enabled: true },

  // -- Markets, finance media & blogs ---------------------------------------
  { id: "yahoo-finance", url: "https://finance.yahoo.com/news/rssindex", name: "Yahoo Finance", category: "general", authority: 72, enabled: true },
  { id: "seeking-alpha-currents", url: "https://seekingalpha.com/market_currents.xml", name: "Seeking Alpha Market Currents", category: "finance", authority: 70, enabled: true },
  { id: "seeking-alpha-all", url: "https://seekingalpha.com/feed.xml", name: "Seeking Alpha", category: "finance", authority: 68, enabled: true },
  { id: "motley-fool", url: "https://www.fool.com/feeds/index.aspx", name: "The Motley Fool", category: "general", authority: 55, enabled: true },
  { id: "business-insider-markets", url: "https://markets.businessinsider.com/rss/news", name: "Business Insider Markets", category: "finance", authority: 62, enabled: true },
  { id: "benzinga", url: "https://www.benzinga.com/feed", name: "Benzinga", category: "finance", authority: 58, enabled: true },
  { id: "the-street", url: "https://www.thestreet.com/.rss/full/", name: "TheStreet", category: "finance", authority: 60, enabled: true },
  { id: "kiplinger", url: "https://www.kiplinger.com/rss", name: "Kiplinger", category: "finance", authority: 60, enabled: true },
  { id: "fortune", url: "https://fortune.com/feed/", name: "Fortune", category: "general", authority: 70, enabled: true },
  { id: "investorplace", url: "https://investorplace.com/feed/", name: "InvestorPlace", category: "finance", authority: 52, enabled: true },
  { id: "247-wall-st", url: "https://247wallst.com/feed/", name: "24/7 Wall St.", category: "finance", authority: 54, enabled: true },
  { id: "money-com", url: "https://money.com/feed/", name: "Money", category: "finance", authority: 56, enabled: true },
  { id: "nerdwallet", url: "https://www.nerdwallet.com/blog/feed/", name: "NerdWallet", category: "finance", authority: 52, enabled: true },
  { id: "zerohedge", url: "https://feeds.feedburner.com/zerohedge/feed", name: "ZeroHedge", category: "finance", authority: 50, enabled: true },
  { id: "calculated-risk", url: "https://feeds.feedburner.com/CalculatedRisk", name: "Calculated Risk", category: "macro", authority: 62, enabled: true },
  { id: "ritholtz", url: "https://ritholtz.com/feed/", name: "The Big Picture", category: "finance", authority: 60, enabled: true },
  { id: "wolf-street", url: "https://wolfstreet.com/feed/", name: "Wolf Street", category: "finance", authority: 56, enabled: true },
  { id: "abnormal-returns", url: "https://abnormalreturns.com/feed/", name: "Abnormal Returns", category: "finance", authority: 58, enabled: true },
  { id: "pragmatic-capitalism", url: "https://www.pragcap.com/feed/", name: "Pragmatic Capitalism", category: "finance", authority: 56, enabled: true },
  { id: "wealth-common-sense", url: "https://awealthofcommonsense.com/feed/", name: "A Wealth of Common Sense", category: "finance", authority: 58, enabled: true },
  { id: "marginal-revolution", url: "https://marginalrevolution.com/feed", name: "Marginal Revolution", category: "macro", authority: 60, enabled: true },
  { id: "naked-capitalism", url: "https://www.nakedcapitalism.com/feed", name: "Naked Capitalism", category: "finance", authority: 52, enabled: true },
  { id: "financial-samurai", url: "https://www.financialsamurai.com/feed/", name: "Financial Samurai", category: "finance", authority: 50, enabled: true },
  { id: "mish-talk", url: "https://mishtalk.com/feed/", name: "MishTalk", category: "macro", authority: 50, enabled: true },
  { id: "econbrowser", url: "https://econbrowser.com/feed", name: "Econbrowser", category: "macro", authority: 58, enabled: true },

  // -- Government, central banks & data --------------------------------------
  { id: "fed-press", url: "https://www.federalreserve.gov/feeds/press_all.xml", name: "Federal Reserve", category: "macro", authority: 95, enabled: true },
  { id: "fed-monetary", url: "https://www.federalreserve.gov/feeds/press_monetary.xml", name: "Fed Monetary Policy", category: "macro", authority: 95, enabled: true },
  { id: "fed-speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml", name: "Fed Speeches", category: "macro", authority: 92, enabled: true },
  { id: "fed-testimony", url: "https://www.federalreserve.gov/feeds/testimony.xml", name: "Fed Testimony", category: "macro", authority: 90, enabled: true },
  { id: "fred-blog", url: "https://fredblog.stlouisfed.org/feed/", name: "FRED Blog", category: "macro", authority: 80, enabled: true },
  { id: "sec-press", url: "https://www.sec.gov/news/pressreleases.rss", name: "SEC Press Releases", category: "finance", authority: 90, enabled: true },
  { id: "bank-of-england", url: "https://www.bankofengland.co.uk/rss/news", name: "Bank of England", category: "macro", authority: 90, enabled: true },
  { id: "fda-press", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml", name: "FDA Press Releases", category: "healthcare", authority: 88, enabled: true },
  { id: "eia-today", url: "https://www.eia.gov/rss/todayinenergy.xml", name: "EIA Today in Energy", category: "energy", authority: 88, enabled: true },

  // -- Business wires & press releases --------------------------------------
  { id: "pr-newswire", url: "https://www.prnewswire.com/rss/news-releases-list.rss", name: "PR Newswire", category: "earnings", authority: 60, enabled: true },

  // -- Technology -----------------------------------------------------------
  { id: "ars-technica", url: "https://feeds.arstechnica.com/arstechnica/index", name: "Ars Technica", category: "tech", authority: 70, enabled: true },
  { id: "techcrunch", url: "https://techcrunch.com/feed/", name: "TechCrunch", category: "tech", authority: 66, enabled: true },
  { id: "the-verge", url: "https://www.theverge.com/rss/index.xml", name: "The Verge", category: "tech", authority: 64, enabled: true },
  { id: "wired", url: "https://www.wired.com/feed/rss", name: "WIRED", category: "tech", authority: 70, enabled: true },
  { id: "engadget", url: "https://www.engadget.com/rss.xml", name: "Engadget", category: "tech", authority: 62, enabled: true },
  { id: "mit-tech-review", url: "https://www.technologyreview.com/feed/", name: "MIT Technology Review", category: "tech", authority: 76, enabled: true },
  { id: "venturebeat", url: "https://venturebeat.com/feed/", name: "VentureBeat", category: "tech", authority: 64, enabled: true },
  { id: "the-register", url: "https://www.theregister.com/headlines.atom", name: "The Register", category: "tech", authority: 66, enabled: true },
  { id: "hacker-news", url: "https://hnrss.org/frontpage", name: "Hacker News", category: "tech", authority: 60, enabled: true },
  { id: "techmeme", url: "https://www.techmeme.com/feed.xml", name: "Techmeme", category: "tech", authority: 68, enabled: true },
  { id: "9to5mac", url: "https://9to5mac.com/feed/", name: "9to5Mac", category: "tech", authority: 60, enabled: true },
  { id: "macrumors", url: "https://feeds.macrumors.com/MacRumors-All", name: "MacRumors", category: "tech", authority: 58, enabled: true },
  { id: "android-police", url: "https://www.androidpolice.com/feed/", name: "Android Police", category: "tech", authority: 56, enabled: true },
  { id: "zdnet", url: "https://www.zdnet.com/news/rss.xml", name: "ZDNet", category: "tech", authority: 62, enabled: true },
  { id: "cnet-news", url: "https://www.cnet.com/rss/news/", name: "CNET News", category: "tech", authority: 60, enabled: true },
  { id: "gizmodo", url: "https://gizmodo.com/rss", name: "Gizmodo", category: "tech", authority: 56, enabled: true },
  { id: "techradar", url: "https://www.techradar.com/rss", name: "TechRadar", category: "tech", authority: 58, enabled: true },
  { id: "toms-hardware", url: "https://www.tomshardware.com/feeds/all", name: "Tom's Hardware", category: "tech", authority: 60, enabled: true },
  { id: "ieee-spectrum", url: "https://spectrum.ieee.org/feeds/feed.rss", name: "IEEE Spectrum", category: "tech", authority: 72, enabled: true },
  { id: "the-next-web", url: "https://thenextweb.com/feed", name: "The Next Web", category: "tech", authority: 58, enabled: true },
  { id: "digital-trends", url: "https://www.digitaltrends.com/feed/", name: "Digital Trends", category: "tech", authority: 56, enabled: true },
  { id: "bleeping-computer", url: "https://www.bleepingcomputer.com/feed/", name: "BleepingComputer", category: "tech", authority: 64, enabled: true },
  { id: "krebs-on-security", url: "https://krebsonsecurity.com/feed/", name: "Krebs on Security", category: "tech", authority: 70, enabled: true },
  { id: "the-hacker-news", url: "https://feeds.feedburner.com/TheHackersNews", name: "The Hacker News", category: "tech", authority: 62, enabled: true },

  // -- Artificial intelligence ----------------------------------------------
  { id: "google-ai-blog", url: "https://blog.google/technology/ai/rss/", name: "Google AI", category: "tech", authority: 74, enabled: true },
  { id: "nvidia-blog", url: "https://blogs.nvidia.com/feed/", name: "NVIDIA Blog", category: "tech", authority: 68, enabled: true },
  { id: "aws-ml-blog", url: "https://aws.amazon.com/blogs/machine-learning/feed/", name: "AWS Machine Learning", category: "tech", authority: 66, enabled: true },
  { id: "venturebeat-ai", url: "https://venturebeat.com/category/ai/feed/", name: "VentureBeat AI", category: "tech", authority: 64, enabled: true },
  { id: "marktechpost", url: "https://www.marktechpost.com/feed/", name: "MarkTechPost", category: "tech", authority: 52, enabled: true },
  { id: "import-ai", url: "https://jack-clark.net/feed/", name: "Import AI", category: "tech", authority: 62, enabled: true },

  // -- Energy & climate -----------------------------------------------------
  { id: "oilprice", url: "https://oilprice.com/rss/main", name: "OilPrice.com", category: "energy", authority: 66, enabled: true },
  { id: "rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", name: "Rigzone", category: "energy", authority: 62, enabled: true },
  { id: "utility-dive", url: "https://www.utilitydive.com/feeds/news/", name: "Utility Dive", category: "energy", authority: 66, enabled: true },
  { id: "world-oil", url: "https://www.worldoil.com/rss?feed=news", name: "World Oil", category: "energy", authority: 62, enabled: true },
  { id: "power-magazine", url: "https://www.powermag.com/feed/", name: "POWER Magazine", category: "energy", authority: 60, enabled: true },
  { id: "pv-magazine", url: "https://www.pv-magazine.com/feed/", name: "pv magazine", category: "energy", authority: 60, enabled: true },
  { id: "electrek", url: "https://electrek.co/feed/", name: "Electrek", category: "energy", authority: 58, enabled: true },
  { id: "carbon-brief", url: "https://www.carbonbrief.org/feed/", name: "Carbon Brief", category: "energy", authority: 66, enabled: true },
  { id: "offshore-technology", url: "https://www.offshore-technology.com/feed/", name: "Offshore Technology", category: "energy", authority: 58, enabled: true },

  // -- Healthcare & biotech -------------------------------------------------
  { id: "stat-news", url: "https://www.statnews.com/feed/", name: "STAT News", category: "healthcare", authority: 74, enabled: true },
  { id: "medcity-news", url: "https://medcitynews.com/feed/", name: "MedCity News", category: "healthcare", authority: 60, enabled: true },
  { id: "biopharma-dive", url: "https://www.biopharmadive.com/feeds/news/", name: "BioPharma Dive", category: "healthcare", authority: 66, enabled: true },
  { id: "healthcare-dive", url: "https://www.healthcaredive.com/feeds/news/", name: "Healthcare Dive", category: "healthcare", authority: 64, enabled: true },

  // -- Crypto ---------------------------------------------------------------
  { id: "cointelegraph", url: "https://cointelegraph.com/rss", name: "Cointelegraph", category: "crypto", authority: 66, enabled: true },
  { id: "decrypt", url: "https://decrypt.co/feed", name: "Decrypt", category: "crypto", authority: 64, enabled: true },
  { id: "the-block", url: "https://www.theblock.co/rss.xml", name: "The Block", category: "crypto", authority: 68, enabled: true },
  { id: "bitcoin-magazine", url: "https://bitcoinmagazine.com/feed", name: "Bitcoin Magazine", category: "crypto", authority: 60, enabled: true },
  { id: "cryptoslate", url: "https://cryptoslate.com/feed/", name: "CryptoSlate", category: "crypto", authority: 56, enabled: true },
  { id: "bitcoinist", url: "https://bitcoinist.com/feed/", name: "Bitcoinist", category: "crypto", authority: 52, enabled: true },
  { id: "beincrypto", url: "https://beincrypto.com/feed/", name: "BeInCrypto", category: "crypto", authority: 54, enabled: true },
  { id: "newsbtc", url: "https://www.newsbtc.com/feed/", name: "NewsBTC", category: "crypto", authority: 52, enabled: true },

  // -- Geopolitics & policy -------------------------------------------------
  { id: "foreign-policy", url: "https://foreignpolicy.com/feed/", name: "Foreign Policy", category: "geopolitical", authority: 72, enabled: true },
  { id: "defense-news", url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", name: "Defense News", category: "geopolitical", authority: 70, enabled: true },
  { id: "war-on-the-rocks", url: "https://warontherocks.com/feed/", name: "War on the Rocks", category: "geopolitical", authority: 68, enabled: true },

  // -- International / regional markets -------------------------------------
  { id: "economic-times-top", url: "https://economictimes.indiatimes.com/rssfeedstopstories.cms", name: "Economic Times Top Stories", category: "general", authority: 68, enabled: true },
  { id: "economic-times-markets", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", name: "Economic Times Markets", category: "finance", authority: 68, enabled: true },
  { id: "livemint-markets", url: "https://www.livemint.com/rss/markets", name: "Mint Markets", category: "finance", authority: 66, enabled: true },
  { id: "livemint-companies", url: "https://www.livemint.com/rss/companies", name: "Mint Companies", category: "finance", authority: 64, enabled: true },
  { id: "business-standard-markets", url: "https://www.business-standard.com/rss/markets-106.rss", name: "Business Standard Markets", category: "finance", authority: 66, enabled: true },
  { id: "the-hindu-business", url: "https://www.thehindu.com/business/feeder/default.rss", name: "The Hindu Business", category: "general", authority: 64, enabled: true },
  { id: "financial-post", url: "https://financialpost.com/feed", name: "Financial Post", category: "finance", authority: 68, enabled: true },
  { id: "straits-times-business", url: "https://www.straitstimes.com/news/business/rss.xml", name: "The Straits Times Business", category: "general", authority: 66, enabled: true },
  { id: "bangkok-post-business", url: "https://www.bangkokpost.com/rss/data/business.xml", name: "Bangkok Post Business", category: "general", authority: 60, enabled: true },

  // -- More national general news & sections --------------------------------
  { id: "bbc-us-canada", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", name: "BBC US & Canada", category: "general", authority: 78, enabled: true },
  { id: "bbc-asia", url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml", name: "BBC Asia", category: "general", authority: 76, enabled: true },
  { id: "bbc-europe", url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml", name: "BBC Europe", category: "general", authority: 76, enabled: true },
  { id: "npr-world", url: "https://feeds.npr.org/1004/rss.xml", name: "NPR World", category: "general", authority: 76, enabled: true },
  { id: "npr-politics", url: "https://feeds.npr.org/1014/rss.xml", name: "NPR Politics", category: "geopolitical", authority: 74, enabled: true },
  { id: "npr-science", url: "https://feeds.npr.org/1007/rss.xml", name: "NPR Science", category: "general", authority: 72, enabled: true },
  { id: "guardian-environment", url: "https://www.theguardian.com/environment/rss", name: "The Guardian Environment", category: "energy", authority: 72, enabled: true },
  { id: "guardian-energy", url: "https://www.theguardian.com/environment/energy/rss", name: "The Guardian Energy", category: "energy", authority: 70, enabled: true },
  { id: "guardian-science", url: "https://www.theguardian.com/science/rss", name: "The Guardian Science", category: "general", authority: 70, enabled: true },
  { id: "guardian-media", url: "https://www.theguardian.com/media/rss", name: "The Guardian Media", category: "general", authority: 66, enabled: true },
  { id: "guardian-crypto", url: "https://www.theguardian.com/technology/cryptocurrencies/rss", name: "The Guardian Cryptocurrencies", category: "crypto", authority: 66, enabled: true },

  // -- More markets, finance media & blogs ----------------------------------
  { id: "valuewalk", url: "https://www.valuewalk.com/feed/", name: "ValueWalk", category: "finance", authority: 54, enabled: true },
  { id: "of-dollars-and-data", url: "https://ofdollarsanddata.com/feed/", name: "Of Dollars And Data", category: "finance", authority: 56, enabled: true },
  { id: "damodaran", url: "https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss", name: "Musings on Markets (Damodaran)", category: "finance", authority: 66, enabled: true },
  { id: "monevator", url: "https://monevator.com/feed/", name: "Monevator", category: "finance", authority: 52, enabled: true },
  { id: "dividend-growth-investor", url: "https://www.dividendgrowthinvestor.com/feeds/posts/default?alt=rss", name: "Dividend Growth Investor", category: "finance", authority: 50, enabled: true },

  // -- More technology ------------------------------------------------------
  { id: "lifehacker", url: "https://lifehacker.com/rss", name: "Lifehacker", category: "tech", authority: 52, enabled: true },
  { id: "makeuseof", url: "https://www.makeuseof.com/feed/", name: "MakeUseOf", category: "tech", authority: 50, enabled: true },
  { id: "xda-developers", url: "https://www.xda-developers.com/feed/", name: "XDA Developers", category: "tech", authority: 54, enabled: true },
  { id: "404media", url: "https://www.404media.co/rss/", name: "404 Media", category: "tech", authority: 64, enabled: true },
  { id: "rest-of-world", url: "https://restofworld.org/feed/latest/", name: "Rest of World", category: "tech", authority: 66, enabled: true },
  { id: "techspot", url: "https://www.techspot.com/backend.xml", name: "TechSpot", category: "tech", authority: 56, enabled: true },
  { id: "phoronix", url: "https://www.phoronix.com/rss.php", name: "Phoronix", category: "tech", authority: 58, enabled: true },
  { id: "semianalysis", url: "https://semianalysis.com/feed/", name: "SemiAnalysis", category: "tech", authority: 70, enabled: true },

  // -- More AI --------------------------------------------------------------
  { id: "microsoft-research", url: "https://www.microsoft.com/en-us/research/feed/", name: "Microsoft Research", category: "tech", authority: 66, enabled: true },
  { id: "bair-blog", url: "https://bair.berkeley.edu/blog/feed.xml", name: "Berkeley AI Research", category: "tech", authority: 64, enabled: true },
  { id: "the-gradient", url: "https://thegradient.pub/rss/", name: "The Gradient", category: "tech", authority: 60, enabled: true },
  { id: "ai-news", url: "https://www.artificialintelligence-news.com/feed/", name: "AI News", category: "tech", authority: 54, enabled: true },
  { id: "unite-ai", url: "https://www.unite.ai/feed/", name: "Unite.AI", category: "tech", authority: 52, enabled: true },

  // -- More energy & climate ------------------------------------------------
  { id: "cleantechnica", url: "https://cleantechnica.com/feed/", name: "CleanTechnica", category: "energy", authority: 56, enabled: true },
  { id: "climate-home", url: "https://www.climatechangenews.com/feed/", name: "Climate Home News", category: "energy", authority: 58, enabled: true },
  { id: "inside-climate-news", url: "https://insideclimatenews.org/feed/", name: "Inside Climate News", category: "energy", authority: 62, enabled: true },

  // -- More healthcare & biotech --------------------------------------------
  { id: "kff-health-news", url: "https://kffhealthnews.org/feed/", name: "KFF Health News", category: "healthcare", authority: 66, enabled: true },
  { id: "science-daily-health", url: "https://www.sciencedaily.com/rss/health_medicine.xml", name: "ScienceDaily Health", category: "healthcare", authority: 58, enabled: true },

  // -- More crypto ----------------------------------------------------------
  { id: "the-defiant", url: "https://thedefiant.io/feed/", name: "The Defiant", category: "crypto", authority: 58, enabled: true },
  { id: "coingape", url: "https://coingape.com/feed/", name: "CoinGape", category: "crypto", authority: 50, enabled: true },
  { id: "u-today", url: "https://u.today/rss", name: "U.Today", category: "crypto", authority: 50, enabled: true },
  { id: "cryptopotato", url: "https://cryptopotato.com/feed/", name: "CryptoPotato", category: "crypto", authority: 50, enabled: true },

  // -- More geopolitics & policy --------------------------------------------
  { id: "foreign-affairs", url: "https://www.foreignaffairs.com/rss.xml", name: "Foreign Affairs", category: "geopolitical", authority: 74, enabled: true },
  { id: "atlantic-council", url: "https://www.atlanticcouncil.org/feed/", name: "Atlantic Council", category: "geopolitical", authority: 68, enabled: true },
  { id: "responsible-statecraft", url: "https://responsiblestatecraft.org/feed/", name: "Responsible Statecraft", category: "geopolitical", authority: 60, enabled: true },

  // -- National papers & wires (US/UK) --------------------------------------
  { id: "wapo-business", url: "https://feeds.washingtonpost.com/rss/business", name: "Washington Post Business", category: "general", authority: 82, enabled: true },
  { id: "wapo-tech", url: "https://feeds.washingtonpost.com/rss/business/technology", name: "Washington Post Technology", category: "tech", authority: 80, enabled: true },
  { id: "la-times-business", url: "https://www.latimes.com/business/rss2.0.xml", name: "Los Angeles Times Business", category: "general", authority: 74, enabled: true },
  { id: "independent-business", url: "https://www.independent.co.uk/news/business/rss", name: "The Independent Business", category: "general", authority: 70, enabled: true },
  { id: "standard-business", url: "https://www.standard.co.uk/business/rss", name: "Evening Standard Business", category: "general", authority: 66, enabled: true },
  { id: "quartz", url: "https://qz.com/rss", name: "Quartz", category: "general", authority: 68, enabled: true },
  { id: "vox", url: "https://www.vox.com/rss/index.xml", name: "Vox", category: "general", authority: 68, enabled: true },
  { id: "the-atlantic-business", url: "https://www.theatlantic.com/feed/channel/business/", name: "The Atlantic Business", category: "general", authority: 72, enabled: true },
  { id: "mashable", url: "https://mashable.com/feeds/rss/all", name: "Mashable", category: "tech", authority: 56, enabled: true },

  // -- Industry Dive trade press --------------------------------------------
  { id: "retail-dive", url: "https://www.retaildive.com/feeds/news/", name: "Retail Dive", category: "general", authority: 66, enabled: true },
  { id: "supply-chain-dive", url: "https://www.supplychaindive.com/feeds/news/", name: "Supply Chain Dive", category: "general", authority: 66, enabled: true },
  { id: "banking-dive", url: "https://www.bankingdive.com/feeds/news/", name: "Banking Dive", category: "finance", authority: 68, enabled: true },
  { id: "cfo-dive", url: "https://www.cfodive.com/feeds/news/", name: "CFO Dive", category: "finance", authority: 66, enabled: true },
  { id: "construction-dive", url: "https://www.constructiondive.com/feeds/news/", name: "Construction Dive", category: "general", authority: 64, enabled: true },
  { id: "marketing-dive", url: "https://www.marketingdive.com/feeds/news/", name: "Marketing Dive", category: "general", authority: 62, enabled: true },
  { id: "restaurant-dive", url: "https://www.restaurantdive.com/feeds/news/", name: "Restaurant Dive", category: "general", authority: 60, enabled: true },
  { id: "hr-dive", url: "https://www.hrdive.com/feeds/news/", name: "HR Dive", category: "general", authority: 60, enabled: true },
  { id: "cio-dive", url: "https://www.ciodive.com/feeds/news/", name: "CIO Dive", category: "tech", authority: 64, enabled: true },
  { id: "legal-dive", url: "https://www.legaldive.com/feeds/news/", name: "Legal Dive", category: "general", authority: 60, enabled: true },
  { id: "grocery-dive", url: "https://www.grocerydive.com/feeds/news/", name: "Grocery Dive", category: "general", authority: 58, enabled: true },
  { id: "waste-dive", url: "https://www.wastedive.com/feeds/news/", name: "Waste Dive", category: "general", authority: 58, enabled: true },

  // -- Sector trades: real estate, semis, transport -------------------------
  { id: "housingwire", url: "https://www.housingwire.com/feed/", name: "HousingWire", category: "finance", authority: 62, enabled: true },
  { id: "eetimes", url: "https://www.eetimes.com/feed/", name: "EE Times", category: "tech", authority: 62, enabled: true },
  { id: "semiconductor-engineering", url: "https://semiengineering.com/feed/", name: "Semiconductor Engineering", category: "tech", authority: 64, enabled: true },
  { id: "servethehome", url: "https://www.servethehome.com/feed/", name: "ServeTheHome", category: "tech", authority: 58, enabled: true },
  { id: "insideevs", url: "https://insideevs.com/rss/articles/all/", name: "InsideEVs", category: "energy", authority: 58, enabled: true },
  { id: "freightwaves", url: "https://www.freightwaves.com/news/feed", name: "FreightWaves", category: "general", authority: 62, enabled: true },
  { id: "simple-flying", url: "https://simpleflying.com/feed/", name: "Simple Flying", category: "general", authority: 56, enabled: true },
  { id: "power-engineering", url: "https://www.power-eng.com/feed/", name: "Power Engineering", category: "energy", authority: 58, enabled: true },
  { id: "renewable-energy-world", url: "https://www.renewableenergyworld.com/feed/", name: "Renewable Energy World", category: "energy", authority: 58, enabled: true },

  // -- More technology / security -------------------------------------------
  { id: "pcmag", url: "https://www.pcmag.com/feeds/rss/latest", name: "PCMag", category: "tech", authority: 58, enabled: true },
  { id: "pcworld", url: "https://www.pcworld.com/index.rss", name: "PCWorld", category: "tech", authority: 56, enabled: true },
  { id: "computerworld", url: "https://www.computerworld.com/index.rss", name: "Computerworld", category: "tech", authority: 58, enabled: true },
  { id: "dark-reading", url: "https://www.darkreading.com/rss.xml", name: "Dark Reading", category: "tech", authority: 62, enabled: true },
  { id: "securityweek", url: "https://feeds.feedburner.com/securityweek", name: "SecurityWeek", category: "tech", authority: 60, enabled: true },
  { id: "the-record", url: "https://therecord.media/feed/", name: "The Record", category: "tech", authority: 62, enabled: true },
  { id: "windows-central", url: "https://www.windowscentral.com/rss", name: "Windows Central", category: "tech", authority: 54, enabled: true },
  { id: "imore", url: "https://www.imore.com/feed", name: "iMore", category: "tech", authority: 52, enabled: true },

  // -- More crypto ----------------------------------------------------------
  { id: "protos", url: "https://protos.com/feed/", name: "Protos", category: "crypto", authority: 54, enabled: true },
  { id: "crypto-briefing", url: "https://cryptobriefing.com/feed/", name: "Crypto Briefing", category: "crypto", authority: 52, enabled: true },
  { id: "bitcoin-com", url: "https://news.bitcoin.com/feed/", name: "Bitcoin.com News", category: "crypto", authority: 52, enabled: true },
  { id: "daily-hodl", url: "https://dailyhodl.com/feed/", name: "The Daily Hodl", category: "crypto", authority: 50, enabled: true },
  { id: "finbold", url: "https://finbold.com/feed/", name: "Finbold", category: "finance", authority: 50, enabled: true },

  // -- More healthcare ------------------------------------------------------
  { id: "genengnews", url: "https://www.genengnews.com/feed/", name: "GEN (Genetic Engineering News)", category: "healthcare", authority: 62, enabled: true },

  // -- More geopolitics & defense -------------------------------------------
  { id: "defense-one", url: "https://www.defenseone.com/rss/all/", name: "Defense One", category: "geopolitical", authority: 66, enabled: true },
  { id: "breaking-defense", url: "https://breakingdefense.com/feed/", name: "Breaking Defense", category: "geopolitical", authority: 64, enabled: true },
  { id: "military-times", url: "https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml", name: "Military Times", category: "geopolitical", authority: 62, enabled: true },

  // -- More government, central banks & data --------------------------------
  { id: "fed-orders", url: "https://www.federalreserve.gov/feeds/press_orders.xml", name: "Fed Enforcement Orders", category: "macro", authority: 88, enabled: true },
  { id: "fed-bcreg", url: "https://www.federalreserve.gov/feeds/press_bcreg.xml", name: "Fed Banking Regulation", category: "macro", authority: 88, enabled: true },
  { id: "cftc", url: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml", name: "CFTC", category: "finance", authority: 86, enabled: true },
  { id: "ny-fed-liberty-street", url: "https://libertystreeteconomics.newyorkfed.org/feed/", name: "NY Fed Liberty Street Economics", category: "macro", authority: 82, enabled: true },

  // -- Policy sections, fintech & business media ----------------------------
  { id: "politico-tech", url: "https://rss.politico.com/technology.xml", name: "Politico Technology", category: "tech", authority: 70, enabled: true },
  { id: "cnbc-real-estate", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000115", name: "CNBC Real Estate", category: "finance", authority: 74, enabled: true },
  { id: "fast-company", url: "https://www.fastcompany.com/latest/rss", name: "Fast Company", category: "general", authority: 62, enabled: true },
  { id: "pymnts", url: "https://www.pymnts.com/feed/", name: "PYMNTS", category: "finance", authority: 58, enabled: true },
  { id: "ecb-press", url: "https://www.ecb.europa.eu/rss/press.html", name: "European Central Bank", category: "macro", authority: 90, enabled: true },
  { id: "sec-speeches", url: "https://www.sec.gov/news/speeches-statements.rss", name: "SEC Speeches & Statements", category: "finance", authority: 84, enabled: true },
];
