# Changelog

## v0.11.1 — Godel Terminal parity: short interest, dividends, halts, IPOs, and options pricing

Five new panes closing the gap with Godel Terminal's equity analysis toolkit.

### New panes

- **Short Interest** (`SI <ticker>`) — shares short, days to cover, average daily volume, and short % of float. Yahoo Finance fallback after FINRA API deprecation. Ticker-scoped research tab + standalone pane.
- **Dividend Yield** (`DVD <ticker>`) — trailing/forward yield, 1Y/3Y growth rates, payment frequency, yield chart, and full dividend history table. Yahoo Finance v8 chart + quoteSummary. Ticker-scoped research tab + standalone pane.
- **Market Halts** (`HALT`) — today's US trading halts with reason codes, halt/resumption times, and All/Active/Resumed filter tabs. Nasdaq Trader RSS feed. Color-coded by status.
- **IPO Calendar** (`IPO`) — upcoming and recent IPOs with pricing, exchange, offer size, shares, first-day return, and SEC S-1 prospectus links. stockanalysis.com + SEC EDGAR. Searchable, sortable, upcoming rows tinted.
- **Black-Scholes Calculator** (`OVME`) — option prices and all five Greeks (delta, gamma, theta, vega, rho) with implied volatility solver. Pure computation, no data source. Call/Put toggle, inputs persist across pane reopen.

### Infrastructure

- All five panes registered in the Connections pane with `registerConnectionSource()`.
- Short Interest and Dividend Yield registered as ticker research tabs alongside Holders, Insider, and Options.
- Market Halts added to Market Overview plugin; IPO Calendar added to Macro plugin; Options Calculator added to Portfolio plugin.

### Fixes

- **HALT** — Nasdaq RSS parser treated ordinary opening tags as self-closing, so every halt was dropped. Feed now returns the live items.
- **IPO** — stockanalysis `__data.json` parser grabbed the session node instead of the IPO node. Calendar now loads upcoming and recent listings. Stock Analysis is registered as its own Connection.
- **DVD** — retired Yahoo v7 CSV + missing `quoteSummary.result[0]` unwrap. History now comes from the v8 chart + shared Yahoo crumb client.
- **SI** — command bar no longer refuses the pane when the active ticker is not a US equity; the pane opens and shows an in-pane message.
- **Kalshi** — hosted users share one Worker egress IP and were 429'd by catalog fan-out. Fewer pages, sequential fetches, 60s poll, and edge-cached public GETs.
- **IPO** — upcoming rows no longer paint `selected` onto every cell (that showed as black patches on hosted).
- **SI** — uses the shared Yahoo crumb client with 429 retries. Hosted Yahoo/Nasdaq/stockanalysis GETs share the same Worker cache as Kalshi.
- **Connections** — a 429 is rate-limited (`Reconnecting` / stay Connected), not a hard Error.

### Follow-ups

- **OVME** — from the options chain, `[c]`alc opens the calculator filled with that contract's spot, strike, expiry, and IV (edit after; not live-tracked).
- **Charts** — `G AAPL:div` / `G AAPL:dvd` plots dividend history from corporate actions. `G president` ranks Kalshi/Polymarket hits instead of tickers that happen to contain the word. The Custom Chart wizard shows the same series dropdown as `G aapl:`.
- **Data Catalog** (`CAT [query]`) — searchable inventory of chartable series. Securities list field names (`Close`, `PEG Ratio`); `[g]`raph asks for a ticker. Options lists contract price/volume fields the same way and asks for an option symbol. Crypto lists pairs like Prediction lists markets. Adjacent loads every index into Other with VoteHub polls. Enter or `[g]`raph charts it; `/` search; `[o]`pen when a series has an external URL.
- **AIBENCH** — AI model intelligence from Artificial Analysis (Intelligence/Coding/Agentic, price vs speed, image/video/audio). Requires an API key.
- **SEC** — `[o]`pen works on the selected filing row, not only after drill-in.
- **Alerts** — `SA AAPL halted`, `SA AAPL short 5`, and `SA AAPL exdiv 7` in addition to price triggers.
- **Portfolio / Watchlist** — `[g]`raph charts the selected ticker through the same `G` series composer as CAT.
- **Adjacent Cloud** — Adjacent, VoteHub polls, and Artificial Analysis live in one Data plugin. Hosted GETs are edge-cached so every user shares one origin pull. RSS stays on News.

## v0.11.0 — Web terminal: panes, shares, charts, and a hosted client that loads

One release note for the hosted web terminal ship.

### Panes

- **Futures** (`FUT`), **AI benchmarks** (`AIBENCH`), **Plugins**, **SEC filings**, **Connections**, **API Keys**, **Polls**, Adjacent indices/rates, and **RSS**.
- TradingView charts with universal series expressions, plus prediction-market series (`G KALSHI:…` / `G POLY:…` / `G ADJ:…`) from venue-direct Kalshi/Polymarket catalogs with native ticker/event/series resolution and a visible TICKER column. Market price history lives in its own **Chart** tab so Overview leads with outcomes.
- News/article reader with command-bar article lookup; firehose with sortable/searchable Origin and Substack bodies; TV live and labelled replays.
- Slim public share pages for articles, charts, and tables at short `/s/{id}` links (~12 chars) instead of booting the full terminal. Legacy `/article?a=…` links still open.

### Features

- Hosted client boots reliably; layouts and plugin config persist per user and sync via Gloom Cloud (BYOK keys stay local). On-device AI when Chrome’s model is available.
- Share charts, articles, and changelog entries with `y`. Open in terminal; logged-out visitors must sign up (Skip hidden). Share chrome matches the terminal pane (grip, title, `[o]`pen).
- Chart quick-add understands Ask-AI-style natural language into series expressions. Faster Jina article fetches with shared boilerplate sanitization and clean-summary fallback across reader, popout, and slim share.
- Expanded curated RSS defaults; Substack auth auto-refreshes. Faster Adjacent Similar/News matching with article links; prediction detail pauses polling on static tabs.
- `FONT+` / `FONT-` scale the whole grid. Pane suggestions in the header; version lives in the status bar.

### Fixes

- Loading hang and terminal startup crashes; TradingView pan stutter; Mac trackpad pinch/scroll zoom on charts, now far less sensitive per swipe.
- Status bar version / @user / delayed chip no longer clips; click the version to open Changelog. Suggestions strip spacing cleaned up.
- Share link hangs and 502s; local AI status no longer stuck on checking; Tab, Ctrl+N, and arrow navigation on web.
- EDGAR/CORS on hosted, broken Adjacent Indices search, IBKR GBX P&L, and non-`http(s)` URL schemes rejected at open.
- JSON-cached prediction history revives `Date` values so chart ranges plot correctly.
