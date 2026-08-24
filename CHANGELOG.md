# Changelog

## v0.13.3 — Research panes, chart indicators, and web accessibility

Six new research surfaces, a technical-indicator library for charts, editable price alerts, and an accessibility and motion pass over the web renderer.

### New panes

- **Earnings Transcripts** (`TRANS <symbol>`) — earnings call transcripts per ticker, searchable from the command bar and opening in the shared article reader.
- **Fundamental Screener** (`SCR`) — screen the listed universe on valuation, growth, margin, and size fundamentals, with clickable header sort and `[s]`earch.
- **Volatility Surface** (`VSURF <symbol>`) — implied-vol heatmap across strikes and expirations, back-solved from the options chain with the existing `impliedVolatility()` solver.
- **ESG & Climate Risk** (`ESG <symbol>`) — Yahoo ESG scores and controversy level. Carbon emissions are typed but not yet populated upstream.
- **Portfolio Risk** (`RISK`) — VaR, factor exposure, and per-position risk contributors, with `[v]` cycling views so the portfolio tabs keep the arrow keys.
- **AI filing summaries** — SEC filings gain an on-demand AI summary with red-flag detection, diffed against the most recent prior filing whose form matches exactly.

### Charts

- Technical indicator library and catalog: SMA, EMA, RSI, MACD, Bollinger Bands, VWAP, ATR, Stochastic, and ADX. This lands the library and catalog only. Wiring `IND:` expressions through `buildSeriesSpec` is deliberately not included, because indicators resolve to *studies* rather than series sources and need a routing change in the chart command path.

### Alerts

- Edit an existing price alert with `[e]` instead of deleting and recreating it. The rule is rebuilt from a field whitelist, so stale trigger state cannot survive an edit and re-fire immediately.

### Web renderer

- Chart gestures stay inside the chart: wheel zoom no longer scrolls the page behind it, and touch pans no longer rubber-band the window.
- `prefers-reduced-motion: reduce` is honored. The row roll-in degrades to opacity only, and the spinner no longer animates `filter`.
- Shared reader pages are keyboard and screen-reader usable: header sort is a real focusable button, loading states announce through `aria-live`, and muted text now clears contrast (3.98:1 → 6.22:1).
- Tab close is reachable from the keyboard via `Delete`, and dialogs confine Tab focus.

### Hosted

- The Worker now sets the security headers upstream sets. CSP stays report-only for now.
- Fixed the hosted client hanging on "Loading Gloomberb...": Cloudflare Static Assets re-compresses `.br` payloads, so build-time pre-compression was applied twice and the bundle arrived undecodable. The Worker serves assets directly again, and the dead pre-compression step has been removed from the build.

### Internal

- `isHostedWebClient()` is shared from `src/shared/hosted-api.ts` rather than redefined across nine call sites.
- `plans/039` and `plans/040` record the web-renderer sweep findings and the upstream port status, including which upstream PRs were rejected and why.

## v0.13.0 — Feature parity: Adjacent Cloud + hosted 0.12.1/0.12.2

Unifies `integration/v0.12.0` (Adjacent Cloud, Data Catalog, Godel panes) with `main` through `release/v0.12.2` (news roll-in, hosted chat realtime, first-class alt-data panes, Polls All tab, Adjacent default layout).

### Adjacent Cloud

- **Adjacent Cloud** owns Polls (`POLL`), AI Benchmarks (`AIBENCH`), Weather (`WX`), and Adjacent indices/rates. One plugin toggle; Connections lists each upstream (VoteHub, llm-stats, TWC, NWS CLI, Adjacent, US listings).
- Hosted clients fetch those sources through `/api/data/{provider}` so the Worker injects secrets, caches prints, and serves every session from one origin pull.
- Weather pane + `G WX:LAX:high` / `G NWS:KNYC:high` series. Climate prediction markets get a Settlement tab that opens the TWC print.
- US listed-universe security master at `/api/data/us-listings/universe` (Nasdaq Trader + SEC OTC, 12h cache).
- Restore Data Catalog (`CAT`) and watchlist/portfolio `[a]`dd / `[d]`elete / `[g]`raph from v0.11.1. Benchmarks in CAT use llm-stats (`BENCH:model:tps`), not Artificial Analysis.
- Restore Godel Terminal parity panes: Short Interest (`SI`), Dividend Yield (`DVD`), Market Halts (`HALT`), IPO Calendar (`IPO`), Black-Scholes (`OVME`), options chain `[c]`alc, `G AAPL:div` / `G AAPL:dvd`, and `SA` halt / short-float / ex-div alerts.
- Hosted Worker deploys to `terminal.kohor.st` on push to `main` (`bun run cloud:deploy`).

### Chat

- Hosted chat can load history, send, and receive live messages. Same-origin `GET`s that omit `Origin` are allowed; writes still require a matching one.
- Realtime authenticates via the Worker: the hosted socket connects same-origin (no token in the URL), and the Worker relays `/cloud/ws` to Gloom Cloud under the server-held session.
- Gloom Cloud chat REST traffic reports through the Connections pane.

### News & reader

- New headlines briefly roll in after the first silent hydrate.
- When Jina or the publisher returns 403/blocked, show a “full text unavailable” empty state with RSS-summary fallback.

### Alt-data panes

- Bond Search (`BOND`), Volatility (`VIX`), Treasury Auctions (`AUCT`), and Credit Spreads (`CRD`) live under Macro. New Highs/Lows (`HILO`) and Options Flow (`FLOW`) live under Market Overview.
- Polls default to an All tab; Adjacent ships as a default layout + watchlist.

### Charts

- **TradingView** pane (`TVC`): ticker-linked Lightweight Charts surface (candles, volume, log scale, drawings, MA/EMA/BB/VWAP). Not TradingView’s licensed Charting Library.

### Worker secrets

CoS sets Worker secrets on gloomberb-cloud. Do not commit values.

- `wrangler secret put ADJACENT_API_KEY`

### Next settlement prints (not registered yet)

BLS first print, EIA weekly, NOAA/NCEI normals, CME settlements, CF Benchmarks (license), AP Elections. Do not scrape Weather Underground. Kalshi/Polymarket/RSS/X/Jina stay off this registry; FRED stays on Gloom Cloud.

## v0.12.3 — Adjacent Cloud data terminal

Hosted users share one cached origin pull for reference prints. Polls, AI Benchmarks, and Weather fold into the Adjacent Cloud plugin. The Worker exposes `GET /api/data/{provider}` instead of one-off routes.

### Adjacent Cloud

- **Adjacent Cloud** owns Polls (`POLL`), AI Benchmarks (`AIBENCH`), Weather (`WX`), and Adjacent indices/rates. One plugin toggle; Connections lists each upstream (VoteHub, llm-stats, TWC, NWS CLI, Adjacent, US listings).
- Hosted clients fetch those sources through `/api/data/{provider}` so the Worker injects secrets, caches prints, and serves every session from one origin pull.
- Weather pane + `G WX:LAX:high` / `G NWS:KNYC:high` series. Climate prediction markets get a Settlement tab that opens the TWC print.
- US listed-universe security master at `/api/data/us-listings/universe` (Nasdaq Trader + SEC OTC, 12h cache).
- Restore Data Catalog (`CAT`) and watchlist/portfolio `[a]dd` / `[d]elete` / `[g]raph` from v0.11.1 — those shipped live and were dropped on the v0.12.0 cut. Benchmarks in CAT use llm-stats (`BENCH:model:tps`), not Artificial Analysis.
- Restore Godel Terminal parity panes that v0.12.0 parked as plans 025–029: Short Interest (`SI`), Dividend Yield (`DVD`), Market Halts (`HALT`), IPO Calendar (`IPO`), Black-Scholes (`OVME`), options chain `[c]`alc, `G AAPL:div` / `G AAPL:dvd`, and `SA` halt / short-float / ex-div alerts. Hosted Yahoo / Nasdaq Trader / stockanalysis GETs share the Worker cache again.
- Hosted Worker deploys to `terminal.kohor.st` on push to `main` and `integration/v0.12.0` (`bun run cloud:deploy`). GitHub Actions needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; existing Worker secrets are left in place.

### Worker secrets

CoS sets Worker secrets on gloomberb-cloud. Do not commit values.

- `wrangler secret put ADJACENT_API_KEY`

### Next settlement prints (not registered yet)

BLS first print, EIA weekly, NOAA/NCEI normals, CME settlements, CF Benchmarks (license), AP Elections. Do not scrape Weather Underground. Kalshi/Polymarket/RSS/X/Jina stay off this registry; FRED stays on Gloom Cloud.
## v0.12.2 — Hosted chat realtime fix

Hosted chat at terminal.kohor.st can load history, send, and receive live messages again.

### Chat

- Fixed hosted chat showing "couldn't reach chat": the Gloom Cloud proxy rejected same-origin `GET`s because browsers omit the `Origin` header on safe methods, so channel/state/message loads were answered with `403`. Reads now allow an absent `Origin`, while writes still require a matching one.
- Realtime now authenticates: the hosted socket connects same-origin to the Worker (no token in the URL), and the Worker relays the `/cloud/ws` upgrade to Gloom Cloud under the server-held session. The browser only ever holds the opaque hosted-session cookie — the raw upstream token is stripped from responses and never captured client-side.
- Gloom Cloud chat REST traffic now reports through the Connections pane.

## v0.12.1 — News roll-in and blocked-reader fallback

News rows briefly roll in when they arrive, and the article reader stays useful when publishers block automated extraction.

### News

- New headlines in firehose, RSS wire, breaking, industry, presets, and ticker news briefly roll in after the first silent hydrate (terminal row tint; web/desktop opacity/brightness).
- Arrival tracking keys on stable article ids so filter hide/show does not re-animate already-seen rows.

### Reader

- When Jina or the publisher returns 403/blocked (common on Investing.com and similar), show a clear “full text unavailable” empty state with RSS-summary fallback when present, instead of a raw `Reader request failed (403)`.
- Footer keeps a short status (`blocked`) plus `[r]`efresh / `[o]`pen / `[y]` share — no duplicated error string in the body and footer.
- Same path covers the terminal reader, Substack reader, and public article share pages.

## v0.12.0 — Alt-data panes, denser news wire, and security hardening

Security, performance, and discovery work from the improve cycle, plus Treasury auctions and a much denser RSS firehose. Bond search and VIX term-structure panes are built but stay hidden until the Gloom Cloud FRED proxy allowlists their series.

### Panes

- **Treasury auctions** (`AUCT`) from Treasury Fiscal Data — Bills, Notes, Bonds/TIPS with sortable auction tables.
- **Plugin discovery** pane — search GitHub for Gloomberb plugins and install from the command bar / pane UI.
- **Bond search** and **Volatility / VIX term structure** panes are implemented and connection-registered, but gated off until the hosted FRED proxy allowlists their series ids (no empty-table ship).
- Godel Terminal parity panes (SI, DVD, HALT, IPO, OVME) shipped on v0.11.1 and are restored in v0.12.3; they are not remaining plans.

### News & shares

- Default RSS wire expanded from ~33 to **335** feeds across wires, national papers, sector trades, government/central-bank releases, tech/AI, energy, healthcare, crypto, and geopolitics.
- Share links use short `/s/{id}` ids; article shares join the same KV-backed path charts and tables already used.

### Security & reliability

- URL scheme validation before opening external links (http/https only).
- Cloudflare Worker: CSP header, SSRF protections on `http.fetch`, stricter Origin checks on the Gloom Cloud proxy, sanitized error responses, BYOK keys endpoint requires auth.
- Updater verifies SHA-256 checksums before installing a new binary.
- Surfaced previously swallowed persistence errors in notes and broker modules.

### Performance

- Chart time-series: O(n log n) reference-point lookup, O(n+m) alignment carry-forward, O(n) price-history window merge.
- DataTable remote-ui metadata memoized; `useRemoteUiNode` registration effect has a real dependency array.
- Linear grouping for statement merges; Adjacent client cache reuse fixed.

### DX & polish

- Knip + Cloudflare Worker typecheck in CI; dead deps removed; `.env.example` completed.
- Sync controller race-condition tests; consistent empty/error states (no unbound retry hints).
- Crypto price symbols skip empty bases; IBKR catch blocks typed as `unknown`.

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
