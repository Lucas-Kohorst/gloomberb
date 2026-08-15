# Changelog

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
