import type { ChangelogRelease } from "../../../updater/github-releases";

const RELEASE_0_13_6: ChangelogRelease = {
  id: "hosted-v0-13-6",
  tagName: "v0.13.6",
  version: "0.13.6",
  title: "Unread click-through, PM search, OPT layout tabs",
  publishedAt: "2026-08-25T14:30:00.000Z",
  url: "",
  body: `Clicking an Unread row opens that chat channel. Prediction Markets search filters grouped Polymarket and Kalshi lists, including multi-word queries. Desktop layout tabs use Option so they no longer steal the browser tab switcher. Empty panes use ESG’s centered two-line no-data copy.

## Chat

- Click a row in Unread — including \`#help unread\` — to open that channel.

## Prediction markets

- Search filters grouped Polymarket and Kalshi rows as you type. Multi-word queries like \`anthropic ipo\` keep only matching events.

## Chrome

- Home / Monitor / Adjacent layout tabs are OPT 1/2/3 on desktop and hosted (Option/Alt). Terminal still uses Ctrl+number / \`^N\`.
- Desktop tabs no longer draw a hover underline on inactive labels like Chart.

## Empty states

- No-data panes center two lines: \`No X data\` / \`{symbol} has no Y.\` Footers keep loading and unavailable chips only.

## What to test

- Unread: click \`#help unread\` (or any row) — chat opens that channel.
- PM: type \`anthropic ipo\` — the list shrinks to matching markets.
- Desktop: Option+1/2/3 switches layouts; Command+1/2/3 does not. No underline on tab hover.
- Empty ESG / holders / news: centered two-line copy.

## Not in this build

- Correlation matrix prediction-market series.
`,
};

const RELEASE_0_13_5: ChangelogRelease = {
  id: "hosted-v0-13-5",
  tagName: "v0.13.5",
  version: "0.13.5",
  title: "First-paint snappiness, PM Enter, layout chrome, upgrade label",
  publishedAt: "2026-08-25T00:00:00.000Z",
  url: "",
  body: `Home stays interactive while feeds fill. Prediction Markets expand grouped rows with Enter and drop leftover 1–4 footer hints. Layout tabs sit on the bottom-left status bar. The delayed-data chip says upgrade.

## First load

- Dense Home first paint no longer blocks drag, resize, chat, or the command bar while RSS, quotes, and catalogs catch up.
- Typing, Command-K / Ctrl+P, and pane resize yield Firehose and quote refreshes so those frames stay snappy after first paint.

## Prediction markets

- One filter row. \`h\`/\`l\` and \`[\` / \`]\` still move filters; Shift+\`h\`/\`l\` still move venues.
- Enter on a grouped event expands or collapses it. Child contracts still open detail.
- Footer no longer advertises \`[1-3]browse\`, \`[4]watchlist\`, or \`[1-4]filter\`.
- Hosted Kalshi catalogs still load when the venue origin 522s.

## Chrome

- Layout tabs and Layouts live on the bottom-left status bar, not the header.
- No static Ctrl+P command-bar hint. Command bar stays on Ctrl+P / Cmd+K.
- Delayed-data CTA is lowercase \`upgrade\`.

## Chat

- DM rows show a green online dot before the name when that peer is present.

## What to test

- Dense Home: drag, resize, command bar, and chat while feeds fill.
- PM grouped row Enter; no 1-3 / 4 footer hints.
- Layout tabs bottom left; \`upgrade\` lowercase; Kalshi still lists markets.

## Not in this build

- Poll chip dropdown (click still cycles 1m / 5m / 15m / 30m). New configs still default to 30m.
`,
};

const RELEASE_0_13_4: ChangelogRelease = {
  id: "hosted-v0-13-4",
  tagName: "v0.13.4",
  version: "0.13.4",
  title: "Prediction markets, Chrome on-device AI, paid Adjacent",
  publishedAt: "2026-08-24T18:00:00.000Z",
  url: "",
  body: `Kalshi and Polymarket catalogs, similar markets, and news go through paid Adjacent. Hosted Chrome can summarize filings with the on-device Prompt API. The PM pane is denser, keyboardable, and searches as you type.

## Prediction markets

- Browse tabs Top / Ending / New / Watchlist move with \`1\`–\`4\` and \`[\` / \`]\`. Categories keep \`h\`/\`l\`; venues keep Shift+\`h\`/\`l\`.
- Narrow panes drop TICKER / VENUE / STATUS / ENDS so TOP ODDS and SPR stay visible. Event rows show \`-\` in TICKER.
- Footer shows the real catalog poll and \`updated\` on the list, not only in detail.
- Search filters the loaded catalog immediately. Hosted Kalshi catalogs load from Adjacent; books still use the Kalshi proxy.
- Related news is the same article table as WIRE. Similar markets use authenticated Adjacent.

## AI

- Hosted default is Chrome's on-device Prompt API. Account Management → AI → Browser (on-device) → Download model. No provider key. Desktop Electrobun still uses Pi.

## News, search, hosted

- TOP is the first 10 stories from WIRE. Category labels are Title Case at display.
- Command bar \`aapl\` lists the security first. Ask AI does not auto-fire on ticker-shaped tokens.
- \`web-main.js\` is hashed. Missing JS chunks 404 instead of returning HTML, so stale tabs stop dying after a deploy.

## Tables and chrome

- Empty cells sort last either direction. New installs default to the Adjacent theme.
- ESG empty Yahoo scores are a no-data state. Watchlists appear in PORT / RISK. Analytics collection tabs are book names only; Overview / Risk is \`[v]\`.
`,
};

const RELEASE_0_13_3: ChangelogRelease = {
  id: "hosted-v0-13-3",
  tagName: "v0.13.3",
  version: "0.13.3",
  title: "Research panes, chart indicators, web accessibility",
  publishedAt: "2026-08-24T12:00:00.000Z",
  url: "",
  body: `Six new research surfaces, a technical-indicator library for charts, editable price alerts, and an accessibility pass over the web terminal.

## Features

- **TRANS** \`<symbol>\` opens earnings call transcripts for a ticker, searchable from the command bar and readable in the shared article reader.
- **SCR** screens the listed universe on valuation, growth, margin, and size fundamentals. Header sort and \`[s]\`earch.
- **VSURF** \`<symbol>\` draws an implied-vol heatmap across strikes and expirations, back-solved from the options chain.
- **ESG** \`<symbol>\` shows Yahoo ESG scores and controversy level. Carbon emissions are not published upstream yet.
- **RISK** shows VaR, factor exposure, beta-weighted market exposure, sector concentration, and best/worst contributors. \`[v]\` cycles views so the portfolio tabs keep the arrow keys.
- SEC filings gain an on-demand AI summary with red-flag detection, diffed against the previous filing of the same form.
- Chart indicators: SMA, EMA, RSI, MACD, Bollinger Bands, VWAP, ATR, Stochastic, ADX. The library and catalog land first; \`IND:\` chart expressions are not wired yet.
- Price alerts are editable with \`[e]\` instead of delete-and-recreate.

## Fixes

- The hosted terminal no longer hangs on "Loading Gloomberb...". Cloudflare re-compresses \`.br\` assets, so build-time pre-compression was applied twice and the bundle arrived undecodable.
- Chart gestures stay in the chart: wheel zoom does not scroll the page, and touch pans do not rubber-band the window.
- \`prefers-reduced-motion\` is honored. Row roll-in degrades to opacity, and the spinner stops animating \`filter\`.
- Shared reader pages are keyboard and screen-reader usable: header sort is a real button, loading states announce, and muted text clears contrast.
- Tab close works from the keyboard with \`Delete\`, and dialogs keep Tab focus inside.
- The Worker sets the same security headers as upstream. CSP stays report-only.
`,
};

const RELEASE_0_13_2: ChangelogRelease = {
  id: "hosted-v0-13-2",
  tagName: "v0.13.2",
  version: "0.13.2",
  title: "Snappier first load, Gloom tweets, crypto quotes",
  publishedAt: "2026-08-21T18:00:00.000Z",
  url: "",
  body: `Hosted first load no longer stalls behind RSS. Tweets follow your Gloom login, Yahoo crypto quotes work on the hosted terminal, and this batch's chat/share/footer polish.

## Performance

- RSS no longer fires all ~229 default feeds at once through the hosted Worker. A cap of 6 runs at a time; Firehose fills as each feed returns. Tweets, quotes, and TV streams are not stuck behind a multi-minute stampede.
- Floating-pane resize L-brackets appear only when the pointer is on a corner handle.

## Features

- **TWIT** opens on Markets. Those tweets also show in Firehose. X Feed tabs persist on hosted. Live polling stays off until you turn it on.
- Tweets come from Gloom Cloud (sign in to Gloom). You do not connect an X account; a logged-out session can look empty.
- Command bar \`dm <user>\` and \`chat <channel>\` open that conversation, including when Chat is already on the layout.
- Unread: Enter opens the selected channel mention; the status unread badge jumps to those messages.
- Share a tweet with \`[y]\` from TWIT or the tweet pop-out — same \`/s/\` reader as articles. The snapshot is the tweet text (x.com is not scraped).
- Substack \`[y]\` share only from the open article, so the link has the full post instead of the list teaser.
- Pane footers use \`[r]\`efresh and \`[/]\` search, and those keys bind.
- Chat presence dots follow the live user list from presence snapshots and websocket payloads, not just the online count. DM and group pane titles show that mark immediately after the username, including while the composer is focused.
- Empty-composer \`[p]\`rofile opens the DM peer; typing \`p\` in a message still inserts the letter. \`WHO\` only lists public profiles.
- Web/desktop inputs opt out of iCloud Passwords, 1Password, and browser autofill.

## Fixes

- CAT no longer crashes on boot. Column header sort works. Web and desktop keep the original system monospace; the IBM Plex font picker is gone.
- Hosted crypto LAST/CHG%/MCAP comes from Yahoo. Pair spellings \`BTC-USD\`, \`SOL/USD\`, and \`ZEC/USD\` resolve to the same coin.
- Portfolio **52W** shows trailing return. The Polls pane loads instead of dying on a footer syntax error.
- Watchlist tickers in Firehose / X / RSS matching keep the full symbol (\`HOOD\`, not \`H\`).
`,
};

const RELEASE_0_13_1: ChangelogRelease = {
  id: "hosted-v0-13-1",
  tagName: "v0.13.1",
  version: "0.13.1",
  title: "Mouse layout, hosted persist, Assets/Data CAT",
  publishedAt: "2026-08-21T00:00:00.000Z",
  url: "",
  body: `Mouse-first layout, hosted workspace persist, CAT split into Assets vs Data, CoinGecko crypto, and the chart/news/PM fixes that were in review.

## Chrome

- Top-left \`<ticker>\` slot is the command bar. Click it for the same prefixes and assist as Ctrl+P; backtick still opens ticker search.
- Drag a pane from the title bar or 6-dot grip. Resize docked tiles on the splitter and floating panes from edges/corners. Keyboard window-edit still works.
- Layout tabs and **Layouts** sit in the desktop titlebar next to Help. Status bar is Ctrl+P on the left and version / delayed data / Upgrade / chat on the right. The stray \`·\` between delayed data and Upgrade is gone.
- **Adjacent** theme (dark ink/forest, RED/BLUE accents). Web/desktop keep the original system monospace stack. ACM **Display** tab sets theme and size (\`FONT+\` / \`FONT-\`).

## Hosted persist

- Watchlist tickers survive refresh. Hosted \`ticker.*\` RPCs are still no-ops; the book lives in per-user localStorage plus \`/api/config\`. An empty load no longer reseeds dummy Adjacent names over a missed hydrate.
- Layouts, plugin config (RSS, TWIT, CAT specs), notes, chat read state, ACM drafts, theme, and font scale persist the same way. A stale Gloom Cloud pull does not wipe a newer local save. BYOK keys stay local.

## CAT and charts

- CAT and the command-bar data terminal group as **Assets** (securities, options, crypto, futures) vs **Data** (FRED, treasuries, Kalshi/Polymarket, Adjacent, polls, OWID, weather, benches). Search is unchanged.
- Crypto LAST/CHG%/MCAP and history come from CoinGecko, not Yahoo. Equities stay on Yahoo. Connections lists CoinGecko.
- OWID search matches title, topic, and slug. Selecting a series charts World by default (\`OWID:life-expectancy:OWID_WRL\`).
- Bond Search (\`BOND\`), credit, VIX, and treasury series actually draw. ICE BofA yields use the real FRED ids; \`TNX\` / \`10Y\` map to \`UST:10Y\`; caret indices skip Yahoo suffix guessing.
- Each series kind has a default spec (candles for assets, step for FRED, probability for PM, percent for polls). A failed series stays in the legend with an error instead of emptying the chart.
- Legend and cursor show full prices (\`$79,432.18\`), not \`$79k\`. Axis ticks stay compact.
- \`[g]\` pops Custom Chart except on DES. \`poll 1m\` sits on the right of the footer.

## News, PM, chat

- X/RSS/Substack share one ticker extractor: cashtags (\`$BTC\`, \`$BRK.B\`), exchange prefixes, and company names from the listings catalog. Firehose starts X and RSS at boot so they do not land minutes after Substack/wire.
- Prediction **News** / **Similar** match on \`platform:raw\` ids, not a title AND search. New **Data** tab maps settlement text onto series we already have (weather highs, CPI, BTC) and \`[g]\` graphs them.
- \`[p]\` pops a selected tweet into a floating reader. Article \`/s/\` links keep full text, open archive/live in a new tab even when signed in, and chart shares are centered with padding.
- Click a chat username, a member chip, or empty-composer \`p\` in a DM for the public profile. \`WHO\` only lists public profiles. Green presence dots use the live presence user list, including nested websocket payloads. The chat pane title shows that mark after the username.

## Connections, plugins, assist

- Connections drops AI provider rows (keys stay in ACM/BYOK). VoteHub, OWID, weather, listings, and Adjacent News fold into one **Adjacent Cloud** row.
- Plugin Marketplace (\`PLUGINS\`) is discovery: search installed + GitHub, then install/toggle/update/remove. \`PL\` is the fast toggle into that same list.
- Assist inventory includes live plugin panes and CAT series (FRED, OWID, crypto, PM, weather). Unprefixed queries like \`cpi\` can suggest a chart.
- High-traffic panes (news, FH, RSS, TWIT, CAT, DES, polls, Substack, chat) have settings panels for columns, default sort/tab, and (TWIT) density/refresh.
- Kelly sizes equity/crypto/FX off last; futures/options only when a position multiplier exists; prediction contracts use the odds mode. Macro series are not positions.

DefiLlama/Artemis/Dune were researched, not shipped. Free Llama TVL is the first candidate; Artemis REST and Dune credits stay BYOK-or-later. See issue #122.
`,
};

const RELEASE_0_13_0: ChangelogRelease = {
  id: "hosted-v0-13-0",
  tagName: "v0.13.0",
  version: "0.13.0",
  title: "Feature parity: Adjacent Cloud + hosted 0.12.1/0.12.2",
  publishedAt: "2026-08-20T13:00:00.000Z",
  url: "",
  body: `Unifies integration/v0.12.0 (Adjacent Cloud, Data Catalog, Godel panes) with main through release/v0.12.2.

## Adjacent Cloud

- **Adjacent Cloud** owns Polls (\`POLL\`), AI Benchmarks (\`AIBENCH\`), Weather (\`WX\`), Our World in Data (\`OWID\`), and Adjacent indices/rates. One plugin toggle; Connections lists each upstream.
- Hosted clients fetch those sources through \`GET /api/data/{provider}\` so the Worker injects secrets, caches prints, and serves every session from one origin pull.
- Restore Data Catalog (\`CAT\`) and Godel panes (SI, DVD, HALT, IPO, OVME) that v0.12.0 parked.
- Our World in Data pane (\`OWID\`): grapher series keyed by chart slug + entity code, CC BY 4.0.
- Data Catalog (\`CAT\`) lists redistributable OWID grapher series (search/browse; 403 charts stay out).

## Chat, news, alt-data

- Hosted chat realtime works again (same-origin GET without Origin; Worker relays \`/cloud/ws\`).
- News rows roll in; blocked article readers show a clear empty state.
- Default RSS wire culled from 336 to **229** feeds: keep hosts Jina can render or that already ship a full RSS body. Adjacent Press stays. Investing.com, NYT, WSJ, and other 403/paywall hosts are out of the defaults (user-added feeds unchanged).
- Bond Search (\`BOND\`), Volatility (\`VIX\`), Treasury Auctions (\`AUCT\`), and Credit Spreads (\`CRD\`) live under Macro. New Highs/Lows (\`HILO\`) and Options Flow (\`FLOW\`) live under Market Overview.
- Polls default to All; Adjacent ships as a default layout + watchlist.
- Polls analysis: pollster house series, race overlay + scatter, and a Kalshi/Polymarket series on the same chart (venue history client-side; polls stay Adjacent Cloud).
- **TradingView** pane (\`TVC\`): ticker-linked Lightweight Charts surface (candles, volume, log scale, drawings, MA/EMA/BB/VWAP). Not the licensed Charting Library.
`,
};

const RELEASE_0_12_3: ChangelogRelease = {
  id: "hosted-v0-12-3",
  tagName: "v0.12.3",
  version: "0.12.3",
  title: "Adjacent Cloud data terminal",
  publishedAt: "2026-08-20T12:00:00.000Z",
  url: "",
  body: `Hosted users share one cached origin pull for reference prints. Polls, AI Benchmarks, and Weather fold into the Adjacent Cloud plugin.

## Adjacent Cloud

- **Adjacent Cloud** owns Polls (\`POLL\`), AI Benchmarks (\`AIBENCH\`), Weather (\`WX\`), Our World in Data (\`OWID\`), and Adjacent indices/rates. One plugin toggle; Connections lists each upstream (VoteHub, llm-stats, TWC, NWS CLI, Adjacent, US listings, OWID).
- Hosted clients fetch those sources through \`GET /api/data/{provider}\` so the Worker injects secrets, caches prints, and serves every session from one origin pull.
- Weather pane plus \`G WX:LAX:high\` / \`G NWS:KNYC:high\` series. Climate prediction markets get a Settlement tab that opens the TWC print.
- US listed-universe security master at \`/api/data/us-listings/universe\` (Nasdaq Trader + SEC OTC, 12h cache).
- Our World in Data at \`/api/data/owid/{slug}/{entity}\` (grapher CSV + metadata, 6h cache, CC BY 4.0).

## Worker secrets

CoS sets Worker secrets on gloomberb-cloud. Do not commit values.

- \`wrangler secret put ADJACENT_API_KEY\`

## Next settlement prints

BLS first print, EIA weekly, NOAA/NCEI normals, CME settlements, and CF Benchmarks (license) register as new keyed-data providers — not new Worker routes. Weather Underground stays off until a first-party API exists. Kalshi, Polymarket, RSS, X, and Jina stay off this registry; FRED stays on Gloom Cloud.
`,
};

const RELEASE_0_12_2: ChangelogRelease = {
  id: "hosted-v0-12-2",
  tagName: "v0.12.2",
  version: "0.12.2",
  title: "Hosted chat realtime fix",
  publishedAt: "2026-08-18T13:00:00.000Z",
  url: "",
  body: `Hosted chat can load history, send, and receive live messages again.

## Chat

- Fixed hosted chat showing “couldn't reach chat”: the Gloom Cloud proxy rejected same-origin \`GET\`s because browsers omit the \`Origin\` header on safe methods, so channel/state/message loads were answered with \`403\`. Reads now allow an absent \`Origin\`, while writes still require a matching one.
- Realtime now authenticates: the hosted socket connects same-origin to the Worker (no token in the URL), and the Worker relays the \`/cloud/ws\` upgrade to Gloom Cloud under the server-held session. The browser only ever holds the opaque hosted-session cookie — the raw upstream token is stripped from responses and never captured client-side.
- Gloom Cloud chat REST traffic now reports through the Connections pane.
`,
};

const RELEASE_0_12_1: ChangelogRelease = {
  id: "hosted-v0-12-1",
  tagName: "v0.12.1",
  version: "0.12.1",
  title: "News roll-in and blocked-reader fallback",
  publishedAt: "2026-08-18T01:30:00.000Z",
  url: "",
  body: `News rows briefly roll in when they arrive, and the article reader stays useful when publishers block automated extraction.

## News

- New headlines in firehose, RSS wire, breaking, industry, presets, and ticker news briefly roll in after the first silent hydrate (terminal row tint; web/desktop opacity/brightness).
- Arrival tracking keys on stable article ids so filter hide/show does not re-animate already-seen rows.

## Reader

- When Jina or the publisher returns 403/blocked (common on Investing.com and similar), show a clear “full text unavailable” empty state with RSS-summary fallback when present, instead of a raw \`Reader request failed (403)\`.
- Footer keeps a short status (\`blocked\`) plus \`[r]\`efresh / \`[o]\`pen / \`[y]\` share — no duplicated error string in the body and footer.
- Same path covers the terminal reader, Substack reader, and public article share pages.
`,
};

const RELEASE_0_12_0: ChangelogRelease = {
  id: "hosted-v0-12-0",
  tagName: "v0.12.0",
  version: "0.12.0",
  title: "Alt-data panes, denser news wire, and security hardening",
  publishedAt: "2026-08-18T00:00:00.000Z",
  url: "",
  body: `Security, performance, and discovery work from the improve cycle, plus Treasury auctions and a much denser RSS firehose. Bond search and VIX term-structure panes are built but stay hidden until the Gloom Cloud FRED proxy allowlists their series.

## Panes

- **Treasury auctions** (\`AUCT\`) from Treasury Fiscal Data — Bills, Notes, Bonds/TIPS with sortable auction tables.
- **Plugin discovery** pane — search GitHub for Gloomberb plugins and install from the command bar / pane UI.
- **Bond search** and **Volatility / VIX term structure** panes are implemented and connection-registered, but gated off until the hosted FRED proxy allowlists their series ids (no empty-table ship).
- Plans for Godel Terminal parity follow-ups: short interest, dividend yield, market halts, IPO calendar, Black-Scholes calculator (\`plans/025–029\`).

## News & shares

- Default RSS wire expanded from ~33 to **335** feeds across wires, national papers, sector trades, government/central-bank releases, tech/AI, energy, healthcare, crypto, and geopolitics.
- Share links use short \`/s/{id}\` ids; article shares join the same KV-backed path charts and tables already used.

## Security & reliability

- URL scheme validation before opening external links (http/https only).
- Cloudflare Worker: CSP header, SSRF protections on \`http.fetch\`, stricter Origin checks on the Gloom Cloud proxy, sanitized error responses, BYOK keys endpoint requires auth.
- Updater verifies SHA-256 checksums before installing a new binary.
- Surfaced previously swallowed persistence errors in notes and broker modules.

## Performance

- Chart time-series: O(n log n) reference-point lookup, O(n+m) alignment carry-forward, O(n) price-history window merge.
- DataTable remote-ui metadata memoized; \`useRemoteUiNode\` registration effect has a real dependency array.
- Linear grouping for statement merges; Adjacent client cache reuse fixed.

## DX & polish

- Knip + Cloudflare Worker typecheck in CI; dead deps removed; \`.env.example\` completed.
- Sync controller race-condition tests; consistent empty/error states (no unbound retry hints).
- Crypto price symbols skip empty bases; IBKR catch blocks typed as \`unknown\`.
`,
};

const RELEASE_0_11_0: ChangelogRelease = {
  id: "hosted-v0-11-0",
  tagName: "v0.11.0",
  version: "0.11.0",
  title: "Web terminal: panes, shares, charts, and a hosted client that loads",
  publishedAt: "2026-08-17T00:00:00.000Z",
  url: "",
  body: `One release note for the hosted web terminal ship.

## Panes

- **Futures** (\`FUT\`), **AI benchmarks** (\`AIBENCH\`), **Plugins**, **SEC filings**, **Connections**, **API Keys**, **Polls**, Adjacent indices/rates, and **RSS**.
- TradingView charts with universal series expressions, plus prediction-market series (\`G KALSHI:…\` / \`G POLY:…\` / \`G ADJ:…\`) from venue-direct Kalshi/Polymarket catalogs with native ticker/event/series resolution and a visible TICKER column. Market price history lives in its own **Chart** tab so Overview leads with outcomes.
- News/article reader with command-bar article lookup; firehose with sortable/searchable Origin and Substack bodies; TV live and labelled replays.
- Slim public share pages for articles, charts, and tables at short \`/s/{id}\` links (~12 chars) instead of booting the full terminal. Legacy \`/article?a=…\` links still open.

## Features

- Hosted client boots reliably; layouts and plugin config persist per user and sync via Gloom Cloud (BYOK keys stay local). On-device AI when Chrome’s model is available.
- Share charts, articles, and changelog entries with \`y\`. Open in terminal; logged-out visitors must sign up (Skip hidden). Share chrome matches the terminal pane (grip, title, \`[o]\`pen).
- Chart quick-add understands Ask-AI-style natural language into series expressions. Faster Jina article fetches with shared boilerplate sanitization and clean-summary fallback across reader, popout, and slim share.
- Expanded curated RSS defaults; Substack auth auto-refreshes. Faster Adjacent Similar/News matching with article links; prediction detail pauses polling on static tabs.
- \`FONT+\` / \`FONT-\` scale the whole grid. Pane suggestions in the header; version lives in the status bar.

## Fixes

- Loading hang and terminal startup crashes; TradingView pan stutter; Mac trackpad pinch/scroll zoom on charts, now far less sensitive per swipe.
- Status bar version / @user / delayed chip no longer clips; click the version to open Changelog. Suggestions strip spacing cleaned up.
- Share link hangs and 502s; local AI status no longer stuck on checking; Tab, Ctrl+N, and arrow navigation on web.
- EDGAR/CORS on hosted, broken Adjacent Indices search, IBKR GBX P&L, and non-\`http(s)\` URL schemes rejected at open.
- JSON-cached prediction history revives \`Date\` values so chart ranges plot correctly.
`,
};

/** Newest first: the pane's default order and the GitHub merge both rely on it. */
export const HOSTED_CHANGELOG_RELEASES: ChangelogRelease[] = [
  RELEASE_0_13_6,
  RELEASE_0_13_5,
  RELEASE_0_13_4,
  RELEASE_0_13_3,
  RELEASE_0_13_2,
  RELEASE_0_13_1,
  RELEASE_0_13_0,
  RELEASE_0_12_3,
  RELEASE_0_12_2,
  RELEASE_0_12_1,
  RELEASE_0_12_0,
  RELEASE_0_11_0,
];

export const HOSTED_CHANGELOG_RELEASE = HOSTED_CHANGELOG_RELEASES[0]!;

export function bundledChangelogReleases(): ChangelogRelease[] {
  return [...HOSTED_CHANGELOG_RELEASES];
}

export function mergeChangelogReleases(
  local: ChangelogRelease[],
  remote: ChangelogRelease[],
): ChangelogRelease[] {
  const seen = new Set(local.map((release) => release.tagName));
  return [...local, ...remote.filter((release) => !seen.has(release.tagName))];
}
