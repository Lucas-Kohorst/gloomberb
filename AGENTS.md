Stack: Bun + OpenTUI

Tests:
- Be selective: add or keep a test only when it protects behavior that is easy to break and hard to catch in review.
- Good test targets: parser/math/state complexity, async/cache/persistence behavior, integration boundaries, and regressions with a concrete failure mode that could plausibly return.
- Weak test targets: static metadata, default props, simple pass-through wiring, copied UI text, or behavior that is obvious from reading the implementation.
- Bug-fix tests are not automatically worth keeping. Keep them only when the bug came from non-obvious behavior or a boundary likely to regress.
- Do not keep low-value tests just because they already exist or improve coverage counts.
- When touching a test file, trim nearby low-value tests if the cleanup is clear and low-risk.

Use tmux to test terminal TUI changes (see the `tui-testing` skill). Always kill the tmux session when done.
Pane footers/status bars should only show status that can change, such as loading, error, live/delayed, stale, or auth state. Do not use them for fixed pane labels, row counts, or generic keyboard hints.
Information density matters: never repeat the same information in a pane title/header and again in the body. If a stack/detail title already names the item, start the body with metadata or content.
For Electrobun/desktop-web-only work, do not load the OpenTUI or tui-testing skills unless the change also touches terminal OpenTUI behavior or explicitly needs tmux coverage.
For desktop/Electrobun/web UI, do not draw GUI primitives with terminal cell characters. Use real DOM/CSS/canvas/SVG primitives for lines, markers, shapes, overlays, and interaction affordances; reserve cell-character drawing for the OpenTUI terminal renderer only.
Add mouse/cursor interactivity for everything interactive.
Never fix chart issues by disabling / turning off the kitty renderer; preserve kitty support and fix the root cause.
When adding new pane/plugin, read PLUGINS.md check how others are made first to keep UI consistent. Always prefer shared UI components and plugin APIs before rolling your own.

Connections:
- Every external API or data source is a Connection. Adjacent, VoteHub/polls, RSS, Kalshi, Polymarket, YouTube/TV, Yahoo, Gloom Cloud, and any new HTTP/WebSocket service must show up in the Connections pane.
- Register it with `registerConnectionSource()` from `src/plugins/builtin/connections/register.ts` in plugin `setup()`, and report traffic through `withConnectionRequest()` / `reportConnectionRequest()` on the real fetch path.
- Do not assume the capability registry will discover it. Hosted/web disables `plugin.capabilities` invoke handlers, so a source that is only listed there will be invisible.
- Do not hardcode only Gloom Cloud. The Connections pane is the inventory of every live integration, not a cloud-status widget.

New panes:
- Give every new pane an AI-visible command-bar shortcut and a description the assist inventory can use.
- News/RSS/Adjacent written-text panes must be searchable from the command bar (`ART` / article lookup) and must open the shared article reader.
- Data tables need clickable header sort (asc/desc), the same as Adjacent Indices. Add `[s]`earch when the list is long enough to filter.

Hosted / logged-in persist:
- Hosted `config.save` is a backend no-op. User layouts, plugin config, RSS feeds, and similar settings must be written through `writeHostedUserConfig()` (keyed by user id) and still pushed via Gloom Cloud sync when the session is verified.
- Do not let a stale cloud pull wipe a newer hosted local save.
- BYOK keys stay local (`writeHostedByokKeys`); never put raw API keys in synced snapshots.

Command-bar AI:
- Assist only maps to prefixes. New panes need shortcuts or they fall out of the inventory. Article/headline queries must also run a local news/Adjacent lookup and offer an Open-article row.

Pane footers:
- Status that can change (loading, error, live/delayed, stale, auth) plus action hints only. No fixed labels, row counts, or generic keyboard hints.
- `[o]`pen when the selected or detail item has an external URL (tweets, articles, polls, filings, markets, changelog, TV).
- `[p]`op out for written articles (news, RSS, Substack).
- `[s]`earch or `/` search when the list is long enough to filter.
- `[r]`efresh for live or network-backed data.
- Bind the hinted key. A footer hint with no handler is a bug.
