# Changelog

## v0.13.8 — Status bar and pane chrome clip

Desktop/hosted chrome no longer shears footer hints or the version pill against parent overflow and the 6px radius.

### Chrome

- Native pane windows no longer clip footer glyphs. Pane body still clips content.
- Floating pane footers sit above the 6px curve instead of losing the bottom of `[r]efresh`.
- Status bar includes the top border in its height, uses line-height 1.15 on the bar itself, and pads the version pill off the window edge.
- Chat composer stays a full row under `pane-content` 100% height. Channel lists still use the shared sidebar scroller.

### What to test

- Hard-reload hosted. Chat footer `[r]efresh` / `[/] search` is a full row, not flush on the rounded edge.
- Status pill `v0.13.8` is not sheared and not flush against the window bottom.

## v0.13.7 — Pane chrome, Robinhood connect

Desktop pane footers keep the top of `[g]raph`. Chat sidebars scroll instead of slicing the last name. Hosted Robinhood sign-in completes OAuth: read every account, trade only Agentic.

### Chrome

- Pane footer hints no longer shear glyphs against the top rule (`[g]raph` reading as `[q]raph`).
- Chat channel lists scroll when they overflow. The splitter meets the footer; the online-count row stays pinned.

### Brokers

- Connect Robinhood on hosted no longer reports **Robinhood setup is incomplete** after a working OAuth path.
- Reads every account. Preview and place only the Agentic account.
- Robinhood Trading MCP is a public OAuth client — no Connections env secret to paste.

### What to test

- Focus a prediction-market pane: `[g]raph` shows a full `g`.
- Float a short chat pane with enough DMs to overflow: last name scrolls, splitter reaches the footer.
- Hosted: BR / RH → Connect Robinhood → **Robinhood sign-in (read accounts, trade Agentic)**. Stay signed in, allow popups. Connections should show connected, not incomplete.

## v0.13.6 — Unread click-through, CDS, CSV, share charts, PM search

Clicking an Unread row opens that chat channel. `CDS` shows DTCC activity. `CSV` copies the focused table. Shared charts fill the page with last / change / range. Prediction Markets search filters grouped lists, and FOMC rows match Fed funds / 10Y feeds. Status bar drops the Layouts chrome and the delayed-data label. Empty panes use ESG’s two-line copy. CORR mixes tickers with `POLY:`, `KALSHI:`, and `ADJ:` series.

### Chat

- Click a row in Unread — including `#help unread` — to open that channel.

### Prediction markets

- Search filters grouped Polymarket and Kalshi rows as you type. Multi-word queries like `anthropic ipo` keep only matching events.
- FOMC / Fed titles map onto `FRED:FEDFUNDS`, `FRED:DFEDTARU`, and `UST:10Y`. Opening a market preloads Adjacent similar markets and news.

### Credit

- `CDS` is market-wide DTCC activity. `CDS ORCL` expands the ticker, then lists issuer activity. Enter drills into an issuer. Spread is only what the report carried.

### Tables and sources

- Command-bar `CSV` copies the focused pane’s current table (clipboard + download, cap 5,000 rows).
- Default RSS adds Prophet Notes, Sentinel, Metaculus, and Don’t Worry About the Vase. `POLX` is an X feed of polling accounts.
- RSS cache stays fresh for 15 minutes instead of 2.

### Share

- Shared charts fill the viewport. The strip is last, window change, high–low, and date range. Probability series report change in percentage points. Hover swaps the strip to that observation.

### Chrome

- Status bar no longer shows a **Layouts** button or numbered layout tabs. Switch layouts with `LAY`, the status-bar context menu, or **OPT 1/2/3** on desktop and hosted (Option/Alt). Terminal still uses Ctrl+number / `^N`.
- Delayed-data CTA is just lowercase `upgrade` — no `delayed data` chip.
- Desktop tabs no longer draw a hover underline on inactive labels like Chart.
- Footer action hints use even spacing and wrap a second row instead of packing together.
- Command-bar `ART` stays snappy while typing: local headlines first, Adjacent only after a 3-character token.

### Empty states

- No-data panes center two lines: `No X data` / `{symbol} has no Y.` Footers keep loading and unavailable chips only.

### Correlation

- `CORR` accepts prediction-market series (`POLY:`, `KALSHI:`, `ADJ:`) alongside tickers. Yes-prices and index levels collapse to daily closes, then the usual Pearson matrix runs. Example: `CORR AAPL, POLY:fed-cut-september`.

### Research

- Equity diagnostic free preview is one cited finding plus an upgrade row. Uncached generation shows Gloom Cloud / SEC / FINRA / news / review steps.

### What to test

- Unread: click `#help unread` (or any row) — chat opens that channel.
- PM: type `anthropic ipo` — the list shrinks. Open an FOMC market — similar + news preload.
- `CDS` and `CDS ORCL` list activity; Enter opens an issuer.
- Focus a table pane, run `CSV` — clipboard / download. `ART tr` is local; `ART trum` may hit Adjacent without freezing the bar.
- Share a chart link — full-pane chart, last / change / range, no repeated title.
- Status bar: no Layouts button or numbered tabs; `upgrade` only. Option+1/2/3 still switches layouts on desktop.
- ESG / holders / news empty: centered two-line copy.
- CORR: `CORR AAPL, POLY:fed-cut-september` fills a mixed matrix.

## v0.13.5 — First-paint snappiness, PM Enter, layout chrome, upgrade label

Home stays interactive while feeds fill. Prediction Markets expand grouped rows with Enter and drop the leftover 1–4 footer hints. Layout tabs sit on the bottom-left status bar again. The delayed-data chip says `upgrade`.

### First load

- Dense Home first paint no longer blocks drag, resize, chat, or the command bar while RSS, quotes, and catalogs catch up.
- Typing, Command-K / Ctrl+P, and pane resize yield Firehose and quote refreshes so those frames stay snappy after first paint.

### Prediction markets

- One filter row: All / Watchlist / Ending / New plus topics. `h`/`l` and `[` / `]` still move filters; Shift+`h`/`l` still move venues.
- Enter on a grouped event expands or collapses it (hosted tab buttons no longer swallow the key). Child contracts still open detail.
- Footer no longer advertises `[1-3]browse`, `[4]watchlist`, or `[1-4]filter`.
- Hosted Kalshi catalogs still load when the venue origin 522s (Adjacent fallback from 0.13.4 follow-up). Retry spacing is already flattened on that path.

### Chrome

- Home / Monitor / Adjacent layout tabs and **Layouts** live on the bottom-left status bar (hosted and desktop), not the header.
- Status bar no longer shows a static `Ctrl+P command bar` hint. Command bar stays on Ctrl+P / Cmd+K and the header ticker.
- Delayed-data CTA next to the version is lowercase `upgrade`.

### Chat

- Direct-message rows show a green online dot before the name when that peer is present. Groups are unchanged.

### What to test

- Dense Home: drag, resize, open the command bar, and type in chat while WIRE / tweets / quotes are still filling.
- PM: Enter on a grouped Kalshi/Polymarket row expands it; Enter on a child opens detail. No `1-3` / `4` browse/watchlist footer hints.
- Layout tabs on the **bottom left**. Switch Home ↔ Monitor; open **Layouts**.
- Chat DM list: green dot immediately before an online peer’s name.
- Status bar: `upgrade` lowercase on delayed data; no `Ctrl+P command bar` label.
- Kalshi still lists markets on hosted (including after a Worker 522).

### Not in this build

- Poll chip **dropdown** (1m / 5m / 15m / 30m option list). Click still cycles those intervals; new configs default to 30m. A follow-up will default to 1m and open a real menu.
- Extra Kalshi 522 retry-flatten beyond what is already on main.

### Also landed since 0.13.4

- Adjacent Indices no longer crash Home on first paint (`useState` import).
- Hosted notes sync, PM footer padding, Kalshi New sort.
- Equity diagnostic pane + ticker logos; read-only Robinhood position sync; hosted config export/import/reset.

## v0.13.4 — Prediction markets, Chrome on-device AI, paid Adjacent

Kalshi and Polymarket catalogs, similar markets, and news now go through paid Adjacent instead of the public API. Hosted Chrome can summarize filings with the on-device Prompt API (no provider key). The PM pane is denser, fully keyboardable, and searches as you type.

### Prediction markets

- Browse tabs **Top / Ending / New / Watchlist** move with `1`–`4` and `[` / `]`. Categories keep `h`/`l`; venues keep Shift+`h`/`l`.
- Narrow panes drop TICKER / VENUE / STATUS / ENDS so **TOP ODDS** and **SPR** stay on screen. Event rows show `-` in TICKER; child contracts keep theirs.
- Footer shows the real catalog poll (`poll 20s` / `30s`) and `updated`, including when detail is closed. Detail still shows Kalshi `poll 5s` / Polymarket `live`.
- Search filters the loaded catalog immediately (fuzzy, token-AND). Remote search is debounced; Polymarket paints `public-search` hits before hydrating every event.
- Hosted Kalshi **catalogs** load from Adjacent (`platform=kalshi`). Order books, trades, and candles still use `/api/proxy/kalshi`.
- Related news uses the same article table as WIRE (`[o]`pen, `[p]`op out, `[a]`rchive). Similar markets and news lists use authenticated Adjacent routes.
- Settlement **Data** tab ranks what a market settles to plus suggested CAT feeds (rules id > resolution map > ticker > alias). Election markets no longer map FRED GDP.

### Adjacent

- Hosted always uses auth `/markets`, `/news`, `/indices`, `/rates` with the Worker key. `/public/...` is gone on hosted. Similar is auth-only; news lists are auth-only; market news is the full ranked list, not the public max-3 slice.
- Search uses `search` / `per_page`. Price history interval `1h` is sent as `1hour`.

### AI

- Hosted default provider is Chrome's on-device Prompt API (`LanguageModel` / Gemini Nano). No Pi key. Filings, Ask AI, the AI screener, and assist fallback all use it once the model is downloaded.
- Account Management → AI → **Browser (on-device) ★** → **Download model** (needs a click; Chrome desktop only). Desktop Electrobun still uses Pi.

### News & command bar

- **TOP** is the first 10 stories from WIRE (`latest`, newest first), not a separate importance feed.
- Category labels are Title Case at display (`tech` → `Tech`).
- Typing `aapl` in the command bar lists the security first (DES / QQ / G as trailing chips). Ask AI no longer auto-fires on ticker-shaped tokens and sorts below Exact Match.
- Screener, article lookup, and new-DM search are case-insensitive (shared fuzzy matcher).

### Hosted

- `web-main.js` is content-hashed like `share-main`. Missing `.js` / `.css` / `.map` return 404 instead of SPA HTML, so a stale tab no longer dies on `chunk-*.js` after a deploy.

### Tables, theme, portfolio

- Empty cells (`—`, `-`, blank, null) sort to the bottom in both directions. Most remaining header no-ops now cycle sort. Financial statement tables stay in GAAP order on purpose.
- New installs and share pages default to the **Adjacent** theme. Saved `amber` configs are left alone.
- ESG shows an honest empty state when Yahoo returns no scores (common on ETFs). The carbon section is hidden until it is populated.
- Watchlists appear in PORT / RISK / Kelly as equal-weight books (risk labeled indicative). Starring a PM market also adds `KALSHI:` / `POLY:` to the default PF watchlist.
- Portfolio Analytics collection tabs are book names only. Overview / Risk is a secondary `[v]` switch, not a third tab on the same strip.

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
