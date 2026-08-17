# Changelog

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
