# Changelog

## v0.13.15 — Kalshi weather index and calibration provenance

Kalshi now publishes a canonical minute-resolution city temperature index used by hourly temperature markets. The weather pane surfaces this as supplementary market evidence alongside the existing NWS and TWC data — without replacing settlement authority.

### Weather

- The station detail view shows the latest complete Kalshi index value (Fahrenheit), the incomplete-point count, and the index config version. When no complete point exists yet, the pane reports "pending quorum" instead of inventing a zero.
- The latest calibration summary (config version, station count, effective time, change reason) appears when Kalshi publishes the `/calibrations` endpoint. Until then the request fails gracefully and the pane omits the line.
- Requests route through the shared Kalshi fetch path and report as `kalshi` traffic in the Connections pane. Hosted clients use the existing Kalshi proxy; native clients call the public endpoint directly.
- Only explicitly supported stations (currently `MIA → miami`) issue a request. Unsupported stations skip the network call entirely.
- Malformed records and incomplete points never become fake zero values. Timestamps tolerate both seconds and milliseconds. Bounded in-memory caches prevent redundant API calls.
- The archive merge loop now coalesces `null` and `undefined` observation fields consistently, so a missing high/low/precip is treated the same way regardless of how the provider omitted it.

## v0.13.14 — Credential safety, watchlist quote hardening, QA introspection

An audit pass over v0.13.13. Three of these fixes repair defects that v0.13.13 itself introduced: a single deadline shared by every prediction-market subscription, which silently re-broke the live-odds P0 it was meant to protect; a config-merge heuristic that could let a remote snapshot overwrite local broker credentials; and a `--data-dir` value that isolated part of the app while the rest wrote to the real home directory. Separately, the remote-control surface no longer serves credentials, and data tables can now be read cell by cell, so automation can catch a *wrong* number instead of only a missing row.

### Prediction markets — watchlist quote hardening

- Subscription setup used one absolute deadline shared across every market in the watchlist. The first market got the full budget and each one after it got whatever remained, so a watchlist long enough to exhaust the budget left its tail permanently unsubscribed — the exact "starred market never ticks" failure the previous release fixed. Each market now gets its own 15-second timeout, cleared in a `finally` so a resolved subscription never leaves a timer pending.
- The subscription retry timer's handle was never stored, so it could not be cancelled on unmount and a torn-down watchlist kept retrying in the background. The handle is now retained and cleared, and retries stop after 20 attempts instead of running forever against a market no provider will ever price.
- The Kalshi poll had no in-flight guard. A poll slower than the 10-second interval overlapped itself, stacking concurrent requests against the same market; a new poll is now skipped while one is still running.

### Brokers — credential safety

- Merging a hosted config snapshot compared *key counts* to decide whether the incoming broker config was richer than the local one. A snapshot that happened to carry more keys — including a redacted or partially-populated one — could therefore replace working local credentials. The local credential bag now always wins; only identity and sync metadata (`brokerType`, `label`, `connectionMode`, `enabled`, `lastSyncedAt`) are taken from the snapshot.
- Re-adding a broker profile matched on the label alone, so two different accounts sharing a label collapsed into one and the first account's credentials were overwritten. Reuse now requires the submitted account to match the stored one, comparing only the fields both define — fields a profile gained after connecting, such as OAuth tokens and account ids, are absent from a fresh form and are no longer counted as a mismatch. A genuine re-add of the same account still reuses its profile, so its portfolios stay attached rather than being stranded; a different account under the same label forks to its own profile.

### Isolation — `--data-dir`

- Two paths still read the real home directory during an isolated run: the AI run-trace module resolved its path at import time, before any flag could apply, and the AI tools module read `process.env.HOME` directly. Both now route through the data-dir-aware plugins directory, so an isolated QA session no longer writes traces into the user's real profile.
- `--data-dir` was validated in the full argument parser but not in the early pass that runs before the first path is derived. A flag-like value such as `--data-dir --headless` became a literal directory named `--headless` for one half of the app while the other half used the real home — state split across two locations. Both paths now share one validator and reject a missing or flag-like value with the same error.

### Remote control — credential redaction

- `app://snapshot` and `app://config` returned the entire app config, credentials included. Both now pass through an allowlist redactor: every value in a broker's config bag and every BYOK API key is replaced with `[redacted]`, while keys, broker identity, and key validation metadata survive — so a QA agent can still assert "this broker has credentials configured" without being handed them. Unrecognized fields are redacted by default, so a future credential field is not exposed by omission.

### Pane footers and command bar

- Removed the `Esc` and `Enter` navigation hints from pane footers. Footers are for status that can change plus action hints; a key that does the same thing in every pane is not either.
- The BYOK key viewer gained an `API` command-bar shortcut, so it appears in the assist inventory instead of being reachable only by navigation.

### QA — data-table introspection

- Data tables expose a `readRows` action over the remote-control surface, returning the rendered text of each cell and group header along with row keys and selection state. This closes the gap that let both marquee bugs of the previous release through: automation could see a group header and its rows existed, but not that the header read `69%` while the row beneath it read `51%`. Reads are pull-based and bounded (default 50 rows, capped at 500), so nothing is added to the pushed snapshot and the memoized table metadata is untouched.

### What to test

- Star a dozen or more prediction markets, then open the Watchlist and confirm every `POLY:` / `KALSHI:` row ticks — not just the first few.
- Re-add a broker profile using the same account as an existing one and confirm it reuses that profile with its portfolios intact; add a different account under the same label and confirm it becomes a separate profile.
- Run `gloomberb --data-dir --headless` and confirm it errors instead of creating a directory named `--headless`.
- Open the BYOK viewer by typing `API` in the command bar.

## v0.13.13 — Prediction-market watchlist odds, broker recovery, pane standardization, QA harness

Broker profiles can no longer be silently deleted by a sync round-trip, and portfolios that outlived their profile are now visible and removable instead of rendering as tabs that can never sync. Prediction-market odds now live-update in the Watchlist. Every pane footer is standardized with honest live/delayed/stale chips, bound action hints, and in-pane search where lists are long enough. The Connections inventory is complete — IBKR, GitHub Releases, SEC Cloud, and Polymarket WS all report traffic. A `GLOOMBERB_DATA_DIR` env var and remote footer snapshots make swarm-style TUI QA practical without `HOME=` hacks or tmux capture.

### Prediction markets — watchlist live odds (P0)

- Starring a Polymarket or Kalshi market upserts a `POLY:`/`KALSHI:` ticker into the default Watchlist. Those rows now receive live odds through a new quote bridge that runs independently of the PM pane focus state.
- Polymarket: resolves `yesTokenId` from the Gamma API, subscribes to CLOB WS, and pushes Quote objects to the market-data coordinator on each odds update (BBO and last-trade).
- Kalshi: polls the market details API every 10 seconds and pushes quotes.
- The coordinator exposes a new `pushQuote(instrument, quote)` method so external sources can populate the quote store without going through the provider router.
- PM tickers are skipped by the watchlist quote watchdog and warmup batches, stopping silent Yahoo/Cloud retry hammering.
- Polymarket CLOB WS connect now reports to `reportConnectionRequest("polymarket", "ws-connect")`.

### Prediction markets — list correctness

- **VENUE** survives at ordinary pane widths and reads `POLY`/`KALSHI`, matching the ticker namespace. It previously required a 148-cell pane, so provenance was effectively never visible.
- **Grouping**: a stale watchlist entry no longer stacks a second copy of an outcome set under one event header. Persisted snapshots still held contracts written under an older id scheme (`${eventId}:${slug}-${n}` rather than the numeric Gamma id), so the same Fed outcome arrived twice with different `marketId`s — the legacy copy carrying no CLOB token, hence frozen at whatever price it was cached at, and winning the group's advertised top odds at 69% while the live children read 49/51. Outcomes now dedupe on the resolved question and prefer the quotable contract. Repeated outcome labels are left intact, because Polymarket reuses `groupItemTitle` across the sides of a line and one game event legitimately lists `Spread -1.5` several times.
- Grouped children are ordered by probability rather than volume, so the outcome the header advertises as the top odds is the first row beneath it.
- A grouped row's spread, last trade, and NO price come from the same contract as the probability it prints, instead of from the highest-volume member.
- **Coloring**: probability reads as a likelihood ramp — green at or above 60%, red at or below 40% — with a neutral band between, so a 49/51 event no longer prints one leg red and the other green off a 2c difference. Detail YES/NO still colors by side.

### Pane footers — honest status and bound hints

- **OpenSky** (`SKY`): footer says "delayed" instead of "live" for the anonymous 15-minute-delayed feed.
- **World indices** (`WEI`): added `paneDelayedStatus()` chip for delayed Yahoo quotes.
- **Sectors** (`BI`): added delayed/error chip; swallowed `getQuotesBatch`/`getPriceHistory` errors now surface.
- **FX matrix** (`FXC`): added delayed chip for delayed Yahoo rates.
- **Market halts** (`HALT`): removed row-count footer; added `/` search.
- **Correlation** (`CORR`): bound `[r]`efresh key (was hinted but never bound).
- **Scanner** (`HILO`/`FLOW`): suppressed delayed chip when payload status is "live" (was showing "15m delayed" and "live" together).
- **Market movers** (`MOST`): background refresh errors now appear in the footer.
- **Market heatmap** (`HM`): Nasdaq fallback fetch wrapped with `withConnectionRequest`.
- **Watchlist/Portfolio** (`PF`/`NW`/`NP`): added live/delayed status chip, `[r]`efresh (force-loads quotes via coordinator), `[o]`pen (Yahoo Finance for equities, Kalshi/Polymarket URLs for PM tickers), with key bindings via `usePaneFooterHintBindings`.
- **Quote Monitor** (ticker detail): added `usePaneStatusFooter` with live/delayed chip and `[r]`efresh.
- **SEC research tab**: added `[/]`search and `[r]`efresh.
- **Transcripts research tab**: added `[r]`efresh.
- **Insider**: added `[r]`efresh on the Form 4 scan.
- **DIAG** (equity diagnostic): partial/stale footer chips now render (existing test fixed).
- **Events/EE**: added `[o]`pen hint for rows with SEC filing URLs.
- **Holders**: added `/` search for institutional holder lists.

### Connections inventory — completeness

- **IBKR**: registered as a connection source (`ibkr`, kind `broker`); Flex HTTP and TWS connect wrapped with `withConnectionRequest`.
- **Screener**: removed duplicate `yahoo-fundamentals` row; folds onto `yahoo` via `YAHOO_FRAGMENT_SOURCE_IDS`.
- **Changelog**: registered `github-releases` source; `api.github.com` fetch wrapped with `withConnectionRequest`.
- **Connections pane**: added `/` and `[s]` search with header sort kept; removed duplicate title/description from body.
- **Yield-curve**: `loadYieldCurve()` and `loadTreasuryYieldMap()` wrapped with `withConnectionRequest("fred-public", ...)`.
- **Satellite**: registered `nasa-firms-public` source (`authRequired: false`) so FIRMS traffic is visible even when the keyed NASA FIRMS plugin is off.
- **SEC Cloud REST**: `getCloudSecFilings`, `getCloudSecFilingDocuments`, `getCloudSecFilingContent` added to `CLOUD_REST_OPS`.
- **TV**: `authRequired: false` on the public YouTube scrape.
- **Congress trades**: `authRequired: true` on the Gloom Cloud keyed PTR source.

### News — RSS, search, Substack, X

- **RSS pane**: filters to RSS-origin articles only (was loading the merged `latest` firehose); shows fetch errors in the empty state instead of "No RSS articles"; feeds manager header no longer duplicates the pane name or shows a row count.
- **News Feed / Sector / Breaking**: added `/` search with `InputSearchBar` for 50-200 row lists.
- **X Feed**: mounted `formatTwitterFeedStatusLine` live/delayed helpers (were unit-tested but never used); added `canCreate` to the `twitter-feed-pane` template.
- **Substack**: `loadSubstackHome`, publication archive, and article detail fetches wrapped with `withConnectionRequest("substack", ...)`.
- **News model**: `buildNewsQueryKey` appends `origin` at the end (existing keys are stable); `filterNewsArticlesForQuery` filters by origin when set.

### Brokers — profiles that vanished, and portfolios that outlived them

- **Broker profiles are no longer deleted when their credentials go missing.** Sync deliberately strips `config` from a broker instance (credentials and OAuth tokens stay on-device), but the config loader treated an instance without `config` as malformed and dropped it. Round-tripping that shape emptied `brokerInstances` entirely — every profile gone, with no error. The loader now keeps the profile and gives it an empty credential bag, so the user re-enters a secret instead of rediscovering their brokers.
- **A remote snapshot can no longer clear local broker profiles or blank their credentials.** Snapshots carry broker identity without secrets, and they were assigned wholesale, so a pull could either empty the list or overwrite live tokens with nothing. The merge now keeps the local credential bag whenever the snapshot has nothing to put in its place, and keeps local-only profiles.
- **A broker-configured workspace is no longer judged a boot placeholder.** The hosted-config fingerprint ignored `brokerInstances` and `portfolios`, so a machine whose only customization was its brokers looked default and lost to an empty remote snapshot.
- **Broker portfolios keep their profile link.** Sync omits broker account identifiers by design, so a synced portfolio came back without `brokerInstanceId` — and both profile removal and stale-portfolio cleanup match on exactly that field. Stranded portfolios could therefore never be cleaned up. The link is now rebuilt from the portfolio id (`broker:<instance>:<account>`) on load, which also repairs configs that already lost it.
- **Orphaned broker portfolios are visible instead of silent.** A portfolio whose profile no longer exists now appears in Brokers as an `Unlinked` row grouped by the missing profile, with an account count and a `[d]`elete action that clears the portfolios and their imported positions. Previously they rendered as ordinary portfolio tabs that could never sync, while the pane reported "0 profiles · 0 connected · 0 issues" — structurally unable to count them, because the issue counter only looked at profiles that still existed.
- **Removal matches on the portfolio id as well as the link,** so a portfolio that already lost its `brokerInstanceId` can still be removed with its profile.
- **Re-adding the same broker account reuses its profile.** `createBrokerInstanceId` suffixed `-2`, `-3`, … on a label collision, so every re-add forked a new profile *and* a new portfolio set, stranding the previous ones with their positions; one real config had reached `-9`. An add that matches an existing broker type and label now updates that profile in place.
- Broker detail no longer repeats the stack title as its first body line, and shows the instance id only when it differs from the label.

### QA harness — swarm-ready TUI testing

- **Data-dir isolation**: `GLOOMBERB_DATA_DIR` env var and `--data-dir` CLI flag. No more `HOME=` redirect needed for isolated TUI sessions.
- **Isolation covers external plugins**: the flag is applied before the first path is derived from it, and the plugins directory is resolved per call rather than cached at import. An isolated run previously still loaded whatever was installed under `$HOME`, where a local plugin could shadow a built-in module id and throw during startup.
- **MaxListeners fix**: `setMaxListeners(20)` on CliRenderer prevents the `MaxListenersExceededWarning` from leaking into the TUI grid.
- **Remote ConnectionTracker snapshot**: `app://connections` resource now includes status, lastPolledAt, lastLatencyMs, successCount, failureCount per source.
- **Remote pane footer snapshot**: new `app://pane-footers` resource lets QA agents assert footer state (live/delayed/stale/error, action hints) without tmux capture. Unlabelled key and bracket nodes are filtered out so callers do not have to strip nulls.
- **Suite isolation**: 70 tests no longer pass or fail based on which files ran before them (`bun test` goes from 91 failures to 21, all of which now also fail on their own). Two process-wide leaks were doing it. Constructing an OpenTUI renderer replaces `globalThis.requestAnimationFrame` and never restores it, so after any render test the global pointed at a destroyed frame loop and every later file that prefers a frame over a timer — market-data notifications, the news aggregator, chat layout — queued callbacks that never ran; a test preload now reinstalls a timer-backed frame before each test. And `mock.module()` swaps the process-wide module registry permanently, so the Kalshi/Polymarket adapter and Adjacent/polls client stubs from the remote-controller and chart-composer suites were still installed for every file afterwards; both suites now capture the real namespaces up front and put them back in `afterAll`.

### What to test

- Star a Polymarket market from the PM pane (`w`), switch to the Watchlist, and confirm the `POLY:` row shows a live odds price that ticks.
- Star a Kalshi market and confirm the `KALSHI:` row updates within ~10 seconds.
- Open OpenSky (`SKY`) and confirm the footer says "delayed", not "live".
- Open the Connections pane (`CONN`), press `/` to search, and confirm IBKR, GitHub Releases, and NASA FIRMS appear.
- Open the Watchlist, press `r` to force-refresh quotes, and press `o` to open the selected ticker's Yahoo Finance page.
- Open Market Movers (`MOST`), trigger a background refresh error, and confirm the error appears in the footer.
- Open Brokers (`BR`) on a config with leftover broker portfolios and confirm each missing profile shows as one `Unlinked` row, the issue count includes them, and `[d]`elete clears the portfolios and their tabs.
- Add a broker profile, remove it, add it again with the same label, and confirm you get one profile and one set of portfolios rather than a `-2` fork.
- Run `GLOOMBERB_DATA_DIR=/tmp/qa bun src/index.tsx` and confirm the app starts with an isolated data directory.
- Use `remote call app://pane-footers` and confirm footer status/hints are returned as structured data.

## v0.13.12 — 4-hour charts, Robinhood desktop sync, chart reliability

Four-hour chart bars are available across supported providers. Robinhood desktop sync now imports equity, crypto, and cash holdings through Trading MCP without duplicate account-agnostic results. CFTC filing lists show ingestion times. Charts retain valid previous-session data while exchanges are closed, repaint after a theme change, and only migrate legacy settings during an explicit config migration.

### Charts

- 4-hour resolution is available for Yahoo, Gloom Cloud, and CoinGecko price history, aggregated on UTC boundaries.
- Persisted intraday history without exchange metadata remains visible outside market hours instead of being discarded as stale.
- Cached chart rasters repaint immediately after a theme change.
- Legacy chart settings are converted only during an explicit migration, not during routine layout sanitization.

### Brokers

- Desktop Robinhood sync imports equity positions, crypto positions, and cash balances.
- Account-scoped position tools run per account; account-agnostic tools run once, avoiding duplicated holdings.
- Robinhood OAuth uses a stable local callback address, ignores stale browser callbacks, times out bounded connection stages, and only starts from an explicit Sync action.

### Data

- CFTC filing timestamps prefer the ingestion time when it is available.

### News

- Canonical feed settings no longer rewrite configuration on every startup; legacy and malformed settings still repair once.

### Prediction markets

- Detail controls preserve table navigation and selection, keep overview and rules panes sized correctly, and restore chart crosshair interaction.

### Weather

- Settlement-aware feeds: NWS station observations, HKO rainfall, Weather Underground fallback, and severe-weather source mapping.
- Weather pane detail shows NWS ASOS station observations as a cross-check against the Kalshi print.
- `WA` weather alerts for threshold crossings, stale TWC, report finalization, and TWC/NWS disagreement.

### Gloom Cloud

- Cloud sync pulls later portfolio changes instead of treating the first pull as permanent.
- Desktop retains a saved session when a cookieless session check returns no user during shutdown.

### What to test

- Set a chart to 4h and verify bars aggregate and refresh normally.
- Sync a Robinhood account with equity, crypto, and cash holdings; each position appears once.
- While markets are closed, reopen an intraday chart and confirm the last valid session remains visible.
- Change the theme with a chart open and confirm the rendered chart repaints.
- Restart with unchanged RSS settings and verify the config is not rewritten.
- Navigate prediction-market book and trades tables with arrow keys.
- Make a cloud portfolio change, sync twice, and verify the later remote update arrives.
- Open WX, select a domestic station, and confirm settlement feed plus NWS ASOS detail.

## v0.13.11 — CFTC on prod Adjacent, firehose ingest, market data overhaul, native-select fix

CFTC filings move off adjacent-dev onto the production Adjacent API. The news firehose flushes query rebuilds on ingest so tweets appear immediately. Yahoo Finance snapshots and the live-quotes engine get a major overhaul. NativeSelect stops painting double text on WebKit. Prediction markets gain a cache layer and live updates.

### Adjacent — CFTC migration

- CFTC filings now use the production Adjacent client (`listFilings`, `getFilingDetail`, `getFilingFilters`) with `search` param, public 90-day window, and auth `/filings` with `org:filings:read`.
- Pane id stays `cftc-filings` so existing layouts remount.
- `adjacent-dev` plugin, BYOK service, catalog entries, hosted worker provider, and `ADJACENT_DEV_API_KEY` injection are deleted.
- Ownership alias `adjacent-dev` → `adjacent` for leftover configs.

### News — firehose, Substack, RSS, X

- `NewsService.ingest` flushes scheduled query rebuilds immediately so pane tweets appear without waiting for the next refresh.
- X pane keeps a global poll chip only. Live-poll UI, extra poll field, and leftover settings removed.
- Substack home loads ingest as `substack-news` on pane load.
- RSS `staleMs` follows `refreshIntervalMinutes` so the cache respects the chip interval.
- Breaking notifications, firehose, industry pane, RSS pane, preset pane, table, and persisted articles updated.
- Article ticker extraction improved.

### Market data — Yahoo Finance, live quotes

- Market-data coordinator (entries, events, quotes, subscriptions) overhauled.
- Yahoo Finance snapshot fetching, options pipeline, request helpers, mappers, and types improved. New snapshot test suite.
- Live-quotes engine improvements with 207 new test lines.
- Inline-ticker resolution and quote-streaming hooks updated.
- New `use-chart-resolution` hook with tests.
- US listings client improvements and test updates.

### Data table and pane chrome

- NativeSelect switches from `appearance:auto` + `WebkitAppearance:menulist` to `appearance:none` with a custom SVG chevron. Fixes the double-text overlap where the native menulist painted its own text layer on top of the custom-styled text (e.g. "Hot Ph" under "White Ph" in theme selectors).
- OpenTUI data table gains row memoization (`row-memo.ts`) to avoid re-rendering unchanged rows.
- Desktop data table index test added.
- Pane content and footer model improvements with test coverage.
- Recently-arrived tracking and CSV export test updates.

### Prediction markets

- New prediction-markets cache module.
- Live-updates controller with test coverage.
- Kalshi adapter and normalizer improvements, adjacent-catalog updates.
- Polymarket adapter and normalizer improvements.
- Catalog and detail controller logic updated. Plugin test coverage expanded.

### Electrobun desktop and plugin registry

- RPC codec improvements with tests. External plugin loading. Renderer window error handling.
- Backend RPC, app services, core capabilities, and desktop initialization updated.
- Plugin registry context, contributions, index, and reload tests updated.
- New `normalize-pane` runtime module with tests.
- New desktop-runtime compile/rewrite/types modules.
- Ticker detail gains a price-series module with tests.

### Misc plugin updates

- Alerts, buildout, cds, chart-composer, congress-trades, connections, correlation, earnings-transcripts, fear-greed, futures, insider, kelly-sizer, market-heatmap, market-movers, notes, options, owid, polls, portfolio-list, research, satellite, scanner, sec, sectors, shared, thirteenf, ticker-detail, traffic, tv, volatility, weather, world-indices, yield-curve, and IBKR trade.

### What to test

- CFTC filings pane opens with prod data; `cftc-filings` layout remounts.
- Firehose tweets appear immediately after ingest (no waiting for next refresh).
- X pane shows only the global poll chip; no live-poll UI.
- Substack home ingests on load; RSS cache respects the chip interval.
- Theme selector in account Display tab shows one name, not overlapping text.
- Prediction markets list loads with cache; live updates refresh prices.
- OpenTUI data table scrolls smoothly with row memoization.

## v0.13.10 — Connections, pane chrome, COMM→FUT, 5m polls

One Yahoo Connection row, shared live/delayed footer chips, commodities on the futures board, and slower default PM/Twitter polls.

### Connections

- Hosted `/api/data` URLs go through `keyedDataUrl`. Adjacent Cloud still folds VoteHub / OWID / weather / listings onto one Connections row. World Bank, OpenSky, and FIRMS stay their own origins.
- Yahoo ESG, screener, dividends, and short-interest report as Yahoo, not extra CONN rows.

### Chrome

- Shared `live` / `delayed` footer chips. Search hints are `/` (screener still binds `s` in-pane).
- WB / AIS / SAT empty copy uses the two-line unavailable helper.

### Futures

- `COMM` opens `FUT` with equity, rates, and FX collapsed. One delayed Yahoo quote poller. HO, PA, ZL, CT, and CC join the board.

### Polls

- Prediction catalog and Twitter default to 5 minutes. The 1/5/15/30 menu still opts into 1m; a stored 1-minute override is kept. RSS stays 30m.

### What to test

- CONN: one Yahoo row; Adjacent Cloud is one row; WB / AIS / SAT still list separately.
- `COMM` and `FUT` open the same futures board; COMM starts with commodity sectors expanded.
- PM / Twitter footer shows `poll 5m` on a fresh config; 1m still available in the interval menu.
- Hard-reload hosted so the status pill shows v0.13.10.

## v0.13.9 — Kalshi proxy, research panes, article chrome

Hosted Kalshi loads from the venue CORS proxy. Firehose RSS collapses by guid. Robinhood hosted OAuth uses a stable callback URI. Disconnect no longer stalls the tab. Article headers are fully draggable and readers drop the poll chip. New research panes: commodities, World Bank, 10-K/Q, AIS traffic, satellite.

### Prediction markets

- Hosted Kalshi venue rows come from the Kalshi CORS proxy, not Adjacent. Delayed Adjacent is fallback only.

### RSS

- Firehose items collapse by RSS/Atom guid, so a later poll with a new permalink does not duplicate the story.

### Brokers

- Hosted Robinhood OAuth always sends `https://terminal.kohor.st/api/oauth/robinhood/callback`. Robinhood must still allowlist that URI.
- Disconnect no longer stalls the tab. Connect no longer throws `Y0 is not defined` from a split robinhood-browser bundle.

### Articles

- Drag article panes from the full header bar.
- Article readers omit the poll 30m chip. Chart pop-outs still refresh.

### Research

- `COMM` — delayed Yahoo commodities board.
- `WB` — World Bank country and regional series.
- `10K` / `10Q` — annual and quarterly SEC reports, searchable from ART, open in the article reader.
- `AIS` — delayed OpenSky aircraft and public Digitraffic AIS ships.
- `SAT` — NASA FIRMS/GIBS satellite imagery.

### What to test

- PM Kalshi on hosted: list fills from the proxy; Adjacent delay only if the proxy fails.
- Firehose: the same guid after a slug change stays one row.
- Hosted Robinhood Connect uses the kohor.st callback (allowlist required). Disconnect returns immediately.
- Drag an article pane from the title bar. Article footer has no poll chip; a chart pop-out still shows poll/refresh.
- `COMM`, `WB`, `10K AAPL`, `AIS`, `SAT` open panes.

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
