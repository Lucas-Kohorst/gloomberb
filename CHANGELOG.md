# Changelog

## 2026.08.16 — Security hardening, performance optimizations, and plugin search

Open this in the app with the Changelog pane (command bar: Changelog).

### Highlights

- URL scheme validation prevents `file://` and `javascript:` URLs from external feeds from opening local applications.
- Cloudflare Worker http.fetch now blocks private/internal IP ranges, closing an SSRF vector on the hosted client.
- Cloudflare Worker error responses no longer leak internal error details to clients.
- Content-Security-Policy header added to the hosted web app for XSS defense-in-depth.
- Self-updater now verifies SHA-256 checksums from GitHub release assets before installing binaries.
- Time-series transform and alignment algorithms optimized from O(n²) and O(n×m) to O(n log n) and O(n+m).
- `useRemoteUiNode` no longer re-registers semantic nodes on every render; DataTable metadata memoized.
- `mergePriceHistoryWindows` uses a two-pointer merge instead of re-sorting the full history.
- Silently swallowed persistence errors in notes and broker modules now surface to users and logs.
- IBKR catch blocks use `error: unknown` with type narrowing instead of `error: any`.
- `gloomberb plugin-search <query>` searches GitHub for installable plugins by keyword.
- CI now typechecks the Cloudflare Worker; dead dependency `web-tree-sitter` removed; `.env.example` completed.

### Security

- `openUrl` and `openExternal` validate the URL scheme (`http:` / `https:` only) before spawning `open`, `cmd`, or `xdg-open`.
- Cloudflare Worker `http.fetch` blocks localhost, RFC-1918, and link-local addresses before proxying.
- Cloudflare Worker catch block maps known user-facing errors (auth, feature gates) and sanitizes all others to a generic message.
- `Content-Security-Policy` header on `serveApp` with `default-src 'self'`, `connect-src 'self' https://api.gloom.sh`, and `frame-ancestors 'none'`.
- Self-updater verifies SHA-256 digest from GitHub's release asset API before swapping the binary; backward compatible with older releases without digests.

### Performance

- `referencePoint` in yoy/qoq transforms uses binary search instead of linear scan (O(n²) → O(n log n)).
- `alignTimeSeries` carry-forward uses a moving pointer per series instead of re-scanning all points (O(n×m) → O(n+m)).
- `mergePriceHistoryWindows` uses a two-pointer merge of two sorted arrays instead of Map + full sort (O(n log n) → O(n)).
- `useRemoteUiNode` effect has a dependency array; 7 UI component callers wrap registrations in `useMemo`.
- DataTable `useRemoteUiNode` metadata (200-row slice) wrapped in `useMemo` to avoid per-render serialization.

### DX and tooling

- `typecheck` script now includes `typecheck:cloud` for the Cloudflare Worker.
- `web-tree-sitter` removed (zero imports across the codebase).
- `.env.example` documents `GLOOMBERB_LANG` and `GLOOMBERB_CLOUD_HOSTED`.
- `catch (error: any)` replaced with `catch (error: unknown)` across 12 IBKR catch blocks.
- Notes and broker persistence catch blocks now log errors instead of silently swallowing them.

### Plugin discovery

- `gloomberb plugin-search <query>` searches GitHub for repos with the `gloomberb-plugin` topic, falling back to a keyword search.
- Results show plugin name, stars, and description; install with `gloomberb install <user/repo>`.

### Tests

- Sync controller race-condition tests: runtime swap mid-pull, contributor apply failure, concurrent requestSync queuing, stale signature skip + force override.
- Time-series transform and alignment edge-case tests.
- `mergePriceHistoryWindows` dedup, override, Date normalization, and empty-input tests.
- Updater checksum verification tests: match, mismatch, and backward-compatible no-checksum cases.
- URL scheme validation tests for `openUrl`.

## 2026.08.15 — Command-bar articles, SEC filings, and the connections inventory

Open this in the app with the Changelog pane (command bar: Changelog).

### Highlights

- Ask the command bar for an article and it searches your enabled news/RSS feeds plus Adjacent Press, offering an Open-article row.
- `sec` now opens a standalone SEC filings browser — latest filings with search — instead of demanding a ticker first.
- The Connections pane is now the inventory of every live integration, with real request traffic, not just a Gloom Cloud status widget.
- Hosted settings (layouts, plugin config, RSS feeds) persist per user and sync through Gloom Cloud; BYOK keys stay local.

### Command bar

- Type "article on …" or "news about …" and get matching articles from subscribed feeds plus Adjacent Press, each with an Open-article row.
- Article and headline queries run a local news/Adjacent lookup, so the AI row no longer dead-ends when a local article already matched.
- AI assist resolves article queries to the ART command and knows your enabled feed names.

### SEC filings

- `sec` opens a browser of the latest 8-K / 10-K / 10-Q / S-1 / 13F filings from the last week.
- Search by ticker, company, or form with `/` or the search bar.
- `sec aapl` (or any symbol) opens SEC with that search prefilled and loads the company's filings.
- Rows include the company name; the footer has `/` search, `[r]efresh`, and `[o]pen`.

### Connections

- Every external API registers in the Connections pane and reports real request traffic.
- Adjacent, VoteHub polls, RSS, Kalshi, Polymarket, TV/YouTube, Yahoo, SEC EDGAR, and Gloom Cloud are all listed.

### Adjacent

- `ADJ <query>` searches prediction markets by text.
- Prediction-market detail gains Similar and News tabs.
- The Indices table gains a ticker column, clickable header sort, and search.

### Hosted client

- User layouts, plugin config, and RSS feeds save per user and sync through Gloom Cloud; a stale cloud pull can't overwrite a newer local save.
- BYOK API keys stay local and are never written into synced snapshots.

### Data tables and footers

- Long tables sort when you click a column header (asc/desc) and offer `[s]`earch.
- Pane footers use consistent, working hints: `[o]`pen, `[p]`op out, `[s]`earch, `[r]`efresh.

## 2026.08.15 — Web terminal: TV, custom APIs, Kalshi, and new panes

Open this in the app with the Changelog pane (command bar: Changelog).

### Highlights

- Custom API keys can be tested, then opened from the command bar by name in a JSON / CSV / text viewer.
- Prediction Markets now ranks Kalshi from Adjacent's full market universe, so high-volume sports and politics show up instead of a thin elections sample.
- TV plays on the hosted web client through a YouTube live embed instead of failing before a player appears.
- New panes: Adjacent indices and rates, API Keys, Connections, RSS, VoteHub Polls, and article pop-out from news / Substack / RSS.

### API Keys

- Add, edit, test, and delete keys for Adjacent, Hyperliquid, SEC EDGAR, or a custom URL.
- Custom keys send a Bearer token on test. A passing test registers the key under its name in the command bar.
- Opening that command fetches the endpoint and renders JSON as a table or key/value pairs, CSV as a table, or text as a scrollable body.
- From the keys list, `t` tests, `o` or Enter opens a tested custom API.
- Keys persist in the hosted browser. They are not synced to Gloom Cloud.

### Prediction Markets

- Top / search catalogs come from Adjacent (`scope=all`, sorted by volume) for both Kalshi and Polymarket.
- Live yes/no quotes still come from the venue after the catalog lands.
- Kalshi 24h volume is contract count, not contracts multiplied by last price.

### TV

- Hosted web no longer errors with "live stream resolution is not available."
- Playback uses YouTube's live embed. Play and mute still use `p` / `m`.

### Web panes

- Floating pane actions stay on one row.
- Pane bodies and tables stretch with the window.
- Adjacent Indices and Rates sort when you click a column header.

### News and reading

- Pop a news, Substack, or RSS article into its own floating pane with `p`.
- RSS feed subscriptions and a reader pane.

### New panes

- Polls (VoteHub), Adjacent, Connections, API Keys.
