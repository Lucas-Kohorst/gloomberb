import type { ChangelogRelease } from "../../../updater/github-releases";

const RELEASE_0_13_15: ChangelogRelease = {
  id: "hosted-v0-13-15",
  tagName: "v0.13.15",
  version: "0.13.15",
  title: "Kalshi weather index and calibration provenance",
  publishedAt: "2026-08-31T21:00:00.000Z",
  url: "",
  body: `Kalshi now publishes a canonical minute-resolution city temperature index used by hourly temperature markets. The weather pane surfaces this as supplementary market evidence alongside the existing NWS and TWC data — without replacing settlement authority.

## Weather

- The station detail view shows the latest complete Kalshi index value (Fahrenheit), the incomplete-point count, and the index config version. When no complete point exists yet, the pane reports "pending quorum" instead of inventing a zero.
- The latest calibration summary (config version, station count, effective time, change reason) appears when Kalshi publishes the \`/calibrations\` endpoint. Until then the request fails gracefully and the pane omits the line.
- Requests route through the shared Kalshi fetch path and report as \`kalshi\` traffic in the Connections pane. Hosted clients use the existing Kalshi proxy; native clients call the public endpoint directly.
- Only explicitly supported stations (currently \`MIA → miami\`) issue a request. Unsupported stations skip the network call entirely.
- Malformed records and incomplete points never become fake zero values. Timestamps tolerate both seconds and milliseconds. Bounded in-memory caches prevent redundant API calls.
- The archive merge loop now coalesces \`null\` and \`undefined\` observation fields consistently, so a missing high/low/precip is treated the same way regardless of how the provider omitted it.`,
};

const RELEASE_0_13_14: ChangelogRelease = {
  id: "hosted-v0-13-14",
  tagName: "v0.13.14",
  version: "0.13.14",
  title: "Credential safety, watchlist quote hardening, QA introspection",
  publishedAt: "2026-08-29T18:00:00.000Z",
  url: "",
  body: `An audit pass over v0.13.13. Three of these fixes repair defects that v0.13.13 itself introduced: a single deadline shared by every prediction-market subscription, which silently re-broke the live-odds fix it was meant to protect; a config-merge heuristic that could let a remote snapshot overwrite local broker credentials; and a \`--data-dir\` value that isolated part of the app while the rest wrote to the real home directory. Separately, the remote-control surface no longer serves credentials, and data tables can now be read cell by cell, so automation can catch a *wrong* number instead of only a missing row.

## Prediction markets

- Subscription setup used one absolute deadline shared across every market in the watchlist. The first market got the full budget and each one after it got whatever remained, so a watchlist long enough to exhaust the budget left its tail permanently unsubscribed — the exact "starred market never ticks" failure the previous release fixed. Each market now gets its own 15-second timeout, cleared in a \`finally\` so a resolved subscription never leaves a timer pending.
- The subscription retry timer's handle was never stored, so it could not be cancelled on unmount and a torn-down watchlist kept retrying in the background. The handle is now retained and cleared, and retries stop after 20 attempts instead of running forever against a market no provider will ever price.
- The Kalshi poll had no in-flight guard. A poll slower than the 10-second interval overlapped itself, stacking concurrent requests against the same market; a new poll is now skipped while one is still running.

## Brokers

- Merging a hosted config snapshot compared *key counts* to decide whether the incoming broker config was richer than the local one. A snapshot that happened to carry more keys — including a redacted or partially-populated one — could therefore replace working local credentials. The local credential bag now always wins; only identity and sync metadata is taken from the snapshot.
- Re-adding a broker profile matched on the label alone, so two different accounts sharing a label collapsed into one and the first account's credentials were overwritten. Reuse now requires the submitted account to match the stored one, comparing only the fields both define — fields a profile gained after connecting, such as OAuth tokens and account ids, are absent from a fresh form and are no longer counted as a mismatch. A genuine re-add of the same account still reuses its profile, so its portfolios stay attached rather than being stranded; a different account under the same label forks to its own profile.

## Isolated runs

- Two paths still read the real home directory during an isolated run: the AI run-trace module resolved its path at import time, before any flag could apply, and the AI tools module read \`process.env.HOME\` directly. Both now route through the data-dir-aware plugins directory, so an isolated QA session no longer writes traces into the user's real profile.
- \`--data-dir\` was validated in the full argument parser but not in the early pass that runs before the first path is derived. A flag-like value such as \`--data-dir --headless\` became a literal directory named \`--headless\` for one half of the app while the other half used the real home — state split across two locations. Both paths now share one validator and reject a missing or flag-like value with the same error.

## Remote control

- \`app://snapshot\` and \`app://config\` returned the entire app config, credentials included. Both now pass through an allowlist redactor: every value in a broker's config bag and every BYOK API key is replaced with \`[redacted]\`, while keys, broker identity, and key validation metadata survive — so a QA agent can still assert "this broker has credentials configured" without being handed them. Unrecognized fields are redacted by default, so a future credential field is not exposed by omission.

## Panes and command bar

- Removed the \`Esc\` and \`Enter\` navigation hints from pane footers. Footers are for status that can change plus action hints; a key that does the same thing in every pane is not either.
- The BYOK key viewer gained an \`API\` command-bar shortcut, so it appears in the assist inventory instead of being reachable only by navigation.
- Data tables expose a \`readRows\` action over the remote-control surface, returning the rendered text of each cell and group header. This closes the gap that let both marquee bugs of the previous release through: automation could see a group header and its rows existed, but not that the header read \`69%\` while the row beneath it read \`51%\`. Reads are pull-based and bounded, so nothing is added to the pushed snapshot.`,
};

const RELEASE_0_13_13: ChangelogRelease = {
  id: "hosted-v0-13-13",
  tagName: "v0.13.13",
  version: "0.13.13",
  title: "Prediction-market watchlist odds, broker recovery, pane standardization, QA harness",
  publishedAt: "2026-08-28T21:40:00.000Z",
  url: "",
  body: `Broker profiles can no longer be silently deleted by a sync round-trip, and portfolios that outlived their profile are now visible and removable instead of rendering as tabs that can never sync. Prediction-market odds now live-update in the Watchlist. Pane footers report honest live/delayed/stale state with every hinted key bound, and long lists gain in-pane search. The Connections inventory is complete — IBKR, GitHub Releases, SEC Cloud, NASA FIRMS, and the Polymarket socket all report traffic. A \`GLOOMBERB_DATA_DIR\` override and remote footer snapshots make isolated TUI QA practical without \`HOME=\` hacks or tmux capture.

## Prediction markets

- Starring a Polymarket or Kalshi market upserts a \`POLY:\` / \`KALSHI:\` ticker into the Watchlist. Those rows now receive live odds through a quote bridge that runs regardless of whether the prediction-market pane is focused.
- Polymarket resolves \`yesTokenId\` from Gamma, subscribes to the CLOB socket, and pushes best-bid/offer and last-trade updates into the market-data coordinator.
- Kalshi polls market details every 10 seconds and pushes the same quote shape.
- The coordinator exposes \`pushQuote(instrument, quote)\` so a plugin can populate the quote store without a provider round-trip.
- Prediction tickers are excluded from the equity quote watchdog and warmup batches, ending silent Yahoo / Gloom Cloud retry loops against symbols no provider can price.
- Polymarket socket connects report through the Connections pane.
- VENUE survives at ordinary pane widths and reads \`POLY\` / \`KALSHI\`, matching the ticker namespace. It previously required a 148-cell pane, so provenance was effectively never visible.
- A stale watchlist entry no longer stacks a second copy of an outcome set under one event header. Persisted snapshots still held contracts written under an older id scheme, so the same Fed outcome arrived twice under different ids — the legacy copy carrying no CLOB token, hence frozen at its cached price, and winning the group's advertised top odds at 69% while the live children read 49/51. Outcomes now dedupe on the resolved question and prefer the quotable contract. Repeated outcome labels are left intact, because Polymarket reuses the outcome title across the sides of a line and one game event legitimately lists \`Spread -1.5\` several times.
- Grouped children are ordered by probability rather than volume, so the outcome the header advertises as the top odds is the first row beneath it.
- A grouped row's spread, last trade, and NO price come from the same contract as the probability it prints, instead of from the highest-volume member.
- Probability reads as a likelihood ramp — green at or above 60%, red at or below 40% — with a neutral band between, so a 49/51 event no longer prints one leg red and the other green off a 2c difference. Detail YES/NO still colors by side.

## Pane footers

- OpenSky reports \`delayed\` instead of \`live\` for the anonymous feed.
- World indices, sectors, and the FX matrix carry delayed chips; sectors also surfaces previously swallowed quote and history errors.
- Scanner no longer prints \`15m delayed\` and \`live\` at the same time.
- Market movers shows background refresh failures. Market halts drops its row count and gains \`/\` search.
- Correlation binds the \`[r]\`efresh key it was already advertising.
- Watchlist and portfolio panes gain a live/delayed chip, \`[r]\`efresh, and \`[o]\`pen — Yahoo Finance for equities, the venue market page for prediction tickers.
- Quote monitor gains a status footer. SEC, transcripts, and insider research tabs gain \`[r]\`efresh; SEC also gains \`[/]\` search.
- Equity diagnostic renders its partial and stale chips. Events rows expose \`[o]\`pen when a filing URL exists. Holders gains \`/\` search.

## Connections

- IBKR registers as a broker source; Flex statement HTTP and TWS gateway connects report traffic.
- GitHub Releases registers as a source and the changelog fetch reports through it.
- NASA FIRMS registers as a public source, so satellite imagery traffic is visible without the keyed plugin.
- Treasury and FRED yield loads report under \`fred-public\`.
- Screener folds onto the existing Yahoo row instead of adding a duplicate \`yahoo-fundamentals\` entry.
- SEC filing, document, and content reads register as Gloom Cloud REST operations.
- The Connections pane itself gains \`/\` and \`[s]\` search, and stops repeating its title in the body.
- TV is marked keyless; congressional trades is marked keyed.

## News

- The RSS pane filters to RSS-origin articles instead of the merged firehose, and shows fetch errors in place of a bare empty state.
- Feed, sector, and breaking panes gain \`/\` search.
- The X feed mounts its live/delayed status helpers and can be created from the pane picker.
- Substack home, archive, and article fetches report through Connections.

## Brokers

- Broker profiles are no longer deleted when their credentials go missing. Sync strips a profile's credential bag on purpose, but the config loader treated a profile without one as malformed and dropped it — round-tripping that shape emptied the broker list entirely, with no error. The loader now keeps the profile and leaves the credentials blank, so you re-enter a secret instead of rediscovering your brokers.
- A cloud snapshot can no longer clear local broker profiles or blank their tokens. Snapshots carry broker identity without secrets and were applied wholesale; the merge now keeps the local credentials whenever the snapshot has nothing to put in their place, and keeps profiles the snapshot has never seen.
- A workspace whose only customization is its brokers is no longer treated as an untouched default that loses to an empty snapshot.
- Broker portfolios keep their link to the profile that owns them. Account identifiers are deliberately kept out of synced payloads, so a synced portfolio came back without one — and both profile removal and stale-portfolio cleanup match on exactly that link, which left stranded portfolios impossible to clear. The link is now rebuilt from the portfolio id on load, repairing configs that already lost it.
- A portfolio whose broker profile no longer exists now shows in Brokers as an \`Unlinked\` row, grouped by the missing profile, with an account count and \`[d]\`elete to clear it and its imported positions. These previously rendered as ordinary portfolio tabs that could never sync while the pane reported zero issues, because the issue count only looked at profiles that still existed.
- Re-adding the same broker account reuses its profile. A label collision used to suffix \`-2\`, \`-3\`, and so on, so every re-add forked a new profile *and* a new set of portfolios, stranding the previous ones with their positions.
- Broker detail no longer repeats the stack title as its first line.

## QA

- \`GLOOMBERB_DATA_DIR\` and \`--data-dir\` isolate a session's data directory.
- That isolation now covers external plugins too. The flag is applied before the first path is derived from it, and the plugins directory is resolved per call rather than cached at import, so an isolated run no longer loads whatever is installed under \`$HOME\` — which could shadow a built-in module id and throw during startup.
- \`app://connections\` exposes per-source status, last poll, latency, and success/failure counts.
- New \`app://pane-footers\` resource exposes footer status and hints as structured data, so footer assertions no longer require terminal capture. Unlabelled key and bracket nodes are filtered out, so callers do not have to strip nulls.
- The renderer raises its listener ceiling so \`MaxListenersExceededWarning\` stops printing into the grid.
- 70 tests no longer pass or fail based on which files ran before them, taking \`bun test\` from 91 failures to 21 — all of which now also fail on their own. Two process-wide leaks were responsible: constructing an OpenTUI renderer replaces \`globalThis.requestAnimationFrame\` and never restores it, so after any render test every later file that prefers a frame over a timer queued callbacks that never ran; and \`mock.module()\` swaps the module registry permanently, leaving venue-adapter and Adjacent/polls stubs installed for every file after the suites that declared them.

## What to test

- Star a Polymarket market, open the Watchlist, and confirm the \`POLY:\` row ticks. Repeat with Kalshi and expect movement within ~10 seconds.
- Confirm \`SKY\` reports delayed, and that scanner shows one freshness chip rather than two.
- Open \`CONN\`, press \`/\`, and confirm IBKR, GitHub Releases, and NASA FIRMS are listed.
- In the Watchlist, press \`r\` to refresh quotes and \`o\` to open the selected row's venue or Yahoo page.
- Open \`BR\` with leftover broker portfolios and confirm each missing profile shows as one \`Unlinked\` row, counted as an issue, and that \`[d]\`elete clears its portfolio tabs.
- Add a broker, remove it, add it again with the same label, and confirm you get one profile rather than a \`-2\` fork.
- Start with \`GLOOMBERB_DATA_DIR=/tmp/qa\` and confirm the session writes nowhere else.
- Read \`app://pane-footers\` and confirm footer status and hints come back as data.
`,
};

const RELEASE_0_13_12: ChangelogRelease = {
  id: "hosted-v0-13-12",
  tagName: "v0.13.12",
  version: "0.13.12",
  title: "4-hour charts, Robinhood desktop sync, chart reliability",
  publishedAt: "2026-08-28T13:05:51.000Z",
  url: "",
  body: `Four-hour chart bars are available across supported providers. Robinhood desktop sync now imports equity, crypto, and cash holdings through Trading MCP without duplicate account-agnostic results. CFTC filing lists show ingestion times. Charts retain valid previous-session data while exchanges are closed, repaint after a theme change, and only migrate legacy settings during an explicit config migration.

## Charts

- 4-hour resolution is available for Yahoo, Gloom Cloud, and CoinGecko price history, aggregated on UTC boundaries.
- Persisted intraday history without exchange metadata remains visible outside market hours instead of being discarded as stale.
- Cached chart rasters repaint immediately after a theme change.
- Legacy chart settings are converted only during an explicit migration, not during routine layout sanitization.

## Brokers

- Desktop Robinhood sync imports equity positions, crypto positions, and cash balances.
- Account-scoped position tools run per account; account-agnostic tools run once, avoiding duplicated holdings.
- Robinhood OAuth uses a stable local callback address, ignores stale browser callbacks, times out bounded connection stages, and only starts from an explicit Sync action.

## Data

- CFTC filing timestamps prefer the ingestion time when it is available.

## News

- Canonical feed settings no longer rewrite configuration on every startup; legacy and malformed settings still repair once.

## Prediction markets

- Detail controls preserve table navigation and selection, keep overview and rules panes sized correctly, and restore chart crosshair interaction.

## Weather

- Settlement-aware feeds: NWS station observations, HKO rainfall, Weather Underground fallback, and severe-weather source mapping.
- Weather pane detail shows NWS ASOS station observations as a cross-check against the Kalshi print.
- \`WA\` weather alerts for threshold crossings, stale TWC, report finalization, and TWC/NWS disagreement.

## Gloom Cloud

- Cloud sync pulls later portfolio changes instead of treating the first pull as permanent.
- Desktop retains a saved session when a cookieless session check returns no user during shutdown.

## What to test

- Set a chart to 4h and verify bars aggregate and refresh normally.
- Sync a Robinhood account with equity, crypto, and cash holdings; each position appears once.
- While markets are closed, reopen an intraday chart and confirm the last valid session remains visible.
- Change the theme with a chart open and confirm the rendered chart repaints.
- Restart with unchanged RSS settings and verify the config is not rewritten.
- Navigate prediction-market book and trades tables with arrow keys.
- Make a cloud portfolio change, sync twice, and verify the later remote update arrives.
- Open WX, select a domestic station, and confirm settlement feed plus NWS ASOS detail.
`,
};

const RELEASE_0_13_11: ChangelogRelease = {
  id: "hosted-v0-13-11",
  tagName: "v0.13.11",
  version: "0.13.11",
  title: "CFTC on prod Adjacent, firehose ingest, market data overhaul, native-select fix",
  publishedAt: "2026-08-26T21:21:16.000Z",
  url: "",
  body: `CFTC filings move off adjacent-dev onto the production Adjacent API. The news firehose flushes query rebuilds on ingest so tweets appear immediately. Yahoo Finance snapshots and the live-quotes engine get a major overhaul. NativeSelect stops painting double text on WebKit. Prediction markets gain a cache layer and live updates.

## Adjacent — CFTC migration

- CFTC filings now use the production Adjacent client (\`listFilings\`, \`getFilingDetail\`, \`getFilingFilters\`) with \`search\` param, public 90-day window, and auth \`/filings\` with \`org:filings:read\`.
- Pane id stays \`cftc-filings\` so existing layouts remount.
- \`adjacent-dev\` plugin, BYOK service, catalog entries, hosted worker provider, and \`ADJACENT_DEV_API_KEY\` injection are deleted.
- Ownership alias \`adjacent-dev\` → \`adjacent\` for leftover configs.

## News — firehose, Substack, RSS, X

- \`NewsService.ingest\` flushes scheduled query rebuilds immediately so pane tweets appear without waiting for the next refresh.
- X pane keeps a global poll chip only. Live-poll UI, extra poll field, and leftover settings removed.
- Substack home loads ingest as \`substack-news\` on pane load.
- RSS \`staleMs\` follows \`refreshIntervalMinutes\` so the cache respects the chip interval.
- Breaking notifications, firehose, industry pane, RSS pane, preset pane, table, and persisted articles updated.
- Article ticker extraction improved.

## Market data — Yahoo Finance, live quotes

- Market-data coordinator (entries, events, quotes, subscriptions) overhauled.
- Yahoo Finance snapshot fetching, options pipeline, request helpers, mappers, and types improved. New snapshot test suite.
- Live-quotes engine improvements with 207 new test lines.
- Inline-ticker resolution and quote-streaming hooks updated.
- New \`use-chart-resolution\` hook with tests.
- US listings client improvements and test updates.

## Data table and pane chrome

- NativeSelect switches from \`appearance:auto\` + \`WebkitAppearance:menulist\` to \`appearance:none\` with a custom SVG chevron. Fixes the double-text overlap where the native menulist painted its own text layer on top of the custom-styled text.
- OpenTUI data table gains row memoization (\`row-memo.ts\`) to avoid re-rendering unchanged rows.
- Desktop data table index test added.
- Pane content and footer model improvements with test coverage.
- Recently-arrived tracking and CSV export test updates.

## Prediction markets

- New prediction-markets cache module.
- Live-updates controller with test coverage.
- Kalshi adapter and normalizer improvements, adjacent-catalog updates.
- Polymarket adapter and normalizer improvements.
- Catalog and detail controller logic updated. Plugin test coverage expanded.

## Electrobun desktop and plugin registry

- RPC codec improvements with tests. External plugin loading. Renderer window error handling.
- Backend RPC, app services, core capabilities, and desktop initialization updated.
- Plugin registry context, contributions, index, and reload tests updated.
- New \`normalize-pane\` runtime module with tests.
- New desktop-runtime compile/rewrite/types modules.
- Ticker detail gains a price-series module with tests.

## What to test

- CFTC filings pane opens with prod data; \`cftc-filings\` layout remounts.
- Firehose tweets appear immediately after ingest (no waiting for next refresh).
- X pane shows only the global poll chip; no live-poll UI.
- Substack home ingests on load; RSS cache respects the chip interval.
- Theme selector in account Display tab shows one name, not overlapping text.
- Prediction markets list loads with cache; live updates refresh prices.
- OpenTUI data table scrolls smoothly with row memoization.
`,
};

const RELEASE_0_13_10: ChangelogRelease = {
  id: "hosted-v0-13-10",
  tagName: "v0.13.10",
  version: "0.13.10",
  title: "Connections, pane chrome, COMM→FUT, 5m polls",
  publishedAt: "2026-08-25T18:15:00.000Z",
  url: "",
  body: `One Yahoo Connection row, shared live/delayed footer chips, commodities on the futures board, and slower default PM/Twitter polls.

## Connections

- Hosted \`/api/data\` URLs go through \`keyedDataUrl\`. Adjacent Cloud still folds VoteHub / OWID / weather / listings onto one Connections row. World Bank, OpenSky, and FIRMS stay their own origins.
- Yahoo ESG, screener, dividends, and short-interest report as Yahoo, not extra CONN rows.

## Chrome

- Shared \`live\` / \`delayed\` footer chips. Search hints are \`/\` (screener still binds \`s\` in-pane).
- WB / AIS / SAT empty copy uses the two-line unavailable helper.

## Futures

- \`COMM\` opens \`FUT\` with equity, rates, and FX collapsed. One delayed Yahoo quote poller. HO, PA, ZL, CT, and CC join the board.

## Polls

- Prediction catalog and Twitter default to 5 minutes. The 1/5/15/30 menu still opts into 1m; a stored 1-minute override is kept. RSS stays 30m.

## What to test

- CONN: one Yahoo row; Adjacent Cloud is one row; WB / AIS / SAT still list separately.
- \`COMM\` and \`FUT\` open the same futures board; COMM starts with commodity sectors expanded.
- PM / Twitter footer shows \`poll 5m\` on a fresh config; 1m still available in the interval menu.
- Hard-reload hosted so the status pill shows v0.13.10.
`,
};

const RELEASE_0_13_9: ChangelogRelease = {
  id: "hosted-v0-13-9",
  tagName: "v0.13.9",
  version: "0.13.9",
  title: "Kalshi proxy, research panes, article chrome",
  publishedAt: "2026-08-25T17:20:00.000Z",
  url: "",
  body: `Hosted Kalshi loads from the venue CORS proxy. Firehose RSS collapses by guid. Robinhood hosted OAuth uses a stable callback URI. Disconnect no longer stalls the tab. Article headers are fully draggable and readers drop the poll chip. New research panes: commodities, World Bank, 10-K/Q, AIS traffic, satellite.

## Prediction markets

- Hosted Kalshi venue rows come from the Kalshi CORS proxy, not Adjacent. Delayed Adjacent is fallback only.

## RSS

- Firehose items collapse by RSS/Atom guid, so a later poll with a new permalink does not duplicate the story.

## Brokers

- Hosted Robinhood OAuth always sends \`https://terminal.kohor.st/api/oauth/robinhood/callback\`. Robinhood must still allowlist that URI.
- Disconnect no longer stalls the tab. Connect no longer throws \`Y0 is not defined\` from a split robinhood-browser bundle.

## Articles

- Drag article panes from the full header bar.
- Article readers omit the poll 30m chip. Chart pop-outs still refresh.

## Research

- \`COMM\` — delayed Yahoo commodities board.
- \`WB\` — World Bank country and regional series.
- \`10K\` / \`10Q\` — annual and quarterly SEC reports, searchable from ART, open in the article reader.
- \`AIS\` — delayed OpenSky aircraft and public Digitraffic AIS ships.
- \`SAT\` — NASA FIRMS/GIBS satellite imagery.

## What to test

- PM Kalshi on hosted: list fills from the proxy; Adjacent delay only if the proxy fails.
- Firehose: the same guid after a slug change stays one row.
- Hosted Robinhood Connect uses the kohor.st callback (allowlist required). Disconnect returns immediately.
- Drag an article pane from the title bar. Article footer has no poll chip; a chart pop-out still shows poll/refresh.
- \`COMM\`, \`WB\`, \`10K AAPL\`, \`AIS\`, \`SAT\` open panes.
`,
};

const RELEASE_0_13_8: ChangelogRelease = {
  id: "hosted-v0-13-8",
  tagName: "v0.13.8",
  version: "0.13.8",
  title: "Status bar and pane chrome clip",
  publishedAt: "2026-08-25T16:10:00.000Z",
  url: "",
  body: `Desktop/hosted chrome no longer shears footer hints or the version pill against parent overflow and the 6px radius.

## Chrome

- Native pane windows no longer clip footer glyphs. Pane body still clips content.
- Floating pane footers sit above the 6px curve instead of losing the bottom of \`[r]efresh\`.
- Status bar includes the top border in its height, uses line-height 1.15 on the bar itself, and pads the version pill off the window edge.
- Chat composer stays a full row under pane-content 100% height. Channel lists still use the shared sidebar scroller.

## What to test

- Hard-reload hosted. Chat footer \`[r]efresh\` / \`[/] search\` is a full row, not flush on the rounded edge.
- Status pill \`v0.13.8\` is not sheared and not flush against the window bottom.
`,
};

const RELEASE_0_13_7: ChangelogRelease = {
  id: "hosted-v0-13-7",
  tagName: "v0.13.7",
  version: "0.13.7",
  title: "Pane chrome, Robinhood connect",
  publishedAt: "2026-08-25T15:35:00.000Z",
  url: "",
  body: `Desktop pane footers keep the top of [g]raph. Chat sidebars scroll instead of slicing the last name. Hosted Robinhood sign-in completes OAuth: read every account, trade only Agentic.

## Chrome

- Pane footer hints no longer shear glyphs against the top rule (\`[g]raph\` reading as \`[q]raph\`).
- Chat channel lists scroll when they overflow. The splitter meets the footer; the online-count row stays pinned.

## Brokers

- Connect Robinhood on hosted no longer reports Robinhood setup is incomplete after a working OAuth path.
- Reads every account. Preview and place only the Agentic account.
- Robinhood Trading MCP is a public OAuth client — no Connections env secret to paste.

## What to test

- Focus a prediction-market pane: \`[g]raph\` shows a full \`g\`.
- Float a short chat pane with enough DMs to overflow: last name scrolls, splitter reaches the footer.
- Hosted: BR / RH → Connect Robinhood → Robinhood sign-in. Stay signed in, allow popups. Connections should show connected, not incomplete.
`,
};

const RELEASE_0_13_6: ChangelogRelease = {
  id: "hosted-v0-13-6",
  tagName: "v0.13.6",
  version: "0.13.6",
  title: "Unread click-through, CDS, CSV, share charts, PM search",
  publishedAt: "2026-08-25T15:05:00.000Z",
  url: "",
  body: `Clicking an Unread row opens that chat channel. CDS shows DTCC activity. CSV copies the focused table. Shared charts fill the page with last / change / range. Prediction Markets search filters grouped lists, and FOMC rows match Fed funds / 10Y feeds. Status bar drops the Layouts chrome and the delayed-data label. Empty panes use ESG’s two-line copy. CORR mixes tickers with POLY:, KALSHI:, and ADJ: series.

## Chat

- Click a row in Unread — including \`#help unread\` — to open that channel.

## Prediction markets

- Search filters grouped Polymarket and Kalshi rows as you type. Multi-word queries like \`anthropic ipo\` keep only matching events.
- FOMC / Fed titles map onto \`FRED:FEDFUNDS\`, \`FRED:DFEDTARU\`, and \`UST:10Y\`. Opening a market preloads Adjacent similar markets and news.

## Credit

- \`CDS\` is market-wide DTCC activity. \`CDS ORCL\` expands the ticker, then lists issuer activity. Enter drills into an issuer.

## Tables and sources

- Command-bar \`CSV\` copies the focused pane’s current table (clipboard + download, cap 5,000 rows).
- Default RSS adds Prophet Notes, Sentinel, Metaculus, and Don’t Worry About the Vase. \`POLX\` is an X feed of polling accounts.
- RSS cache stays fresh for 15 minutes instead of 2.

## Share

- Shared charts fill the viewport. The strip is last, window change, high–low, and date range. Probability series report change in percentage points.

## Chrome

- Status bar no longer shows a Layouts button or numbered layout tabs. Switch layouts with \`LAY\`, the status-bar context menu, or OPT 1/2/3 on desktop and hosted. Terminal still uses Ctrl+number / \`^N\`.
- Delayed-data CTA is just lowercase \`upgrade\` — no delayed data chip.
- Desktop tabs no longer draw a hover underline on inactive labels like Chart.
- Footer action hints use even spacing and wrap a second row instead of packing together.
- Command-bar \`ART\` stays snappy while typing: local headlines first, Adjacent only after a 3-character token.

## Empty states

- No-data panes center two lines: \`No X data\` / \`{symbol} has no Y.\` Footers keep loading and unavailable chips only.

## Correlation

- \`CORR\` accepts prediction-market series (\`POLY:\`, \`KALSHI:\`, \`ADJ:\`) alongside tickers. Example: \`CORR AAPL, POLY:fed-cut-september\`.

## Research

- Equity diagnostic free preview is one cited finding plus an upgrade row.

## What to test

- Unread: click \`#help unread\` (or any row) — chat opens that channel.
- PM: type \`anthropic ipo\` — the list shrinks. Open an FOMC market — similar + news preload.
- \`CDS\` and \`CDS ORCL\` list activity; Enter opens an issuer.
- Focus a table pane, run \`CSV\`. \`ART tr\` is local; \`ART trum\` may hit Adjacent without freezing the bar.
- Share a chart link — full-pane chart, last / change / range.
- Status bar: no Layouts button or numbered tabs; \`upgrade\` only. Option+1/2/3 still switches layouts on desktop.
- Empty ESG / holders / news: centered two-line copy.
- CORR: \`CORR AAPL, POLY:fed-cut-september\` fills a mixed matrix.
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
  RELEASE_0_13_15,
  RELEASE_0_13_14,
  RELEASE_0_13_13,
  RELEASE_0_13_12,
  RELEASE_0_13_11,
  RELEASE_0_13_10,
  RELEASE_0_13_9,
  RELEASE_0_13_8,
  RELEASE_0_13_7,
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
