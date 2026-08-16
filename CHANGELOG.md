# Changelog

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
