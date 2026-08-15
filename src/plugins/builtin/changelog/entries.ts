import type { ChangelogRelease } from "../../../updater/github-releases";

export const HOSTED_CHANGELOG_RELEASE: ChangelogRelease = {
  id: "hosted-2026-08-15",
  tagName: "2026.08.15",
  version: "2026.08.15",
  title: "Web terminal: TV, custom APIs, Kalshi, and new panes",
  publishedAt: "2026-08-15T20:00:00.000Z",
  url: "",
  body: `## Highlights

- Custom API keys can be tested, then opened from the command bar by name in a JSON / CSV / text viewer.
- Prediction Markets now ranks Kalshi from Adjacent's full market universe, so high-volume sports and politics show up instead of a thin elections sample.
- TV plays on the hosted web client through a YouTube live embed instead of failing before a player appears.
- New panes: Adjacent indices and rates, API Keys, Connections, RSS, VoteHub Polls, and article pop-out from news / Substack / RSS.

## Changes

### API Keys

- Add, edit, test, and delete keys for Adjacent, Hyperliquid, SEC EDGAR, or a custom URL.
- Custom keys send a Bearer token on test. A passing test registers the key **under its name** in the command bar.
- Opening that command fetches the endpoint and renders JSON as a table or key/value pairs, CSV as a table, or text as a scrollable body. Auto sniffs the format.
- From the keys list, \`t\` tests, \`o\` or Enter opens a tested custom API.
- Keys persist in the hosted browser. They are not synced to Gloom Cloud.

### Prediction Markets

- Top / search catalogs come from Adjacent (\`scope=all\`, sorted by volume) for both Kalshi and Polymarket.
- Live yes/no quotes still come from the venue after the catalog lands.
- Kalshi 24h volume is contract count, not contracts multiplied by last price.
- Native Kalshi / Polymarket catalogs remain the fallback, and still power New and Ending.

### TV

- Hosted web no longer errors with "live stream resolution is not available."
- Playback uses YouTube's live embed (channel or resolved video). Play and mute still use \`p\` / \`m\`.

### Web panes

- Floating pane actions stay on one row. The \`⋯\` menu no longer stacks under the float and close buttons.
- Pane bodies and tables stretch with the window instead of leaving an empty strip after resize.
- Adjacent Indices and Rates sort when you click a column header.

### News and reading

- Pop a news, Substack, or RSS article into its own floating pane with \`p\`. The list stays behind it.
- RSS feed subscriptions and a reader pane.

### New and restored panes

- **Polls** — VoteHub approval, favorability, generic ballot, Senate, governor, and House (free, no key).
- **Adjacent** — prediction-market indices and reference rates.
- **Connections** — live status for data providers and APIs.
- **API Keys** — BYOK settings.

### Hosted client

- Plugin config such as API keys survives a refresh on the hosted client.
- Opening a ticker that already has a pane focuses that pane instead of spawning another.
- Column settings persist.

## How to try it

- Command bar: \`KEYS\` for API Keys, then add a custom key, test it, and search its name.
- Command bar: \`TV\` for Bloomberg / CNBC / Yahoo Finance.
- Command bar: \`PM\` for Prediction Markets, Top tab, Kalshi or All.
- Command bar: Changelog to reopen these notes.
`,
};

export function bundledChangelogReleases(): ChangelogRelease[] {
  return [HOSTED_CHANGELOG_RELEASE];
}

export function mergeChangelogReleases(
  local: ChangelogRelease[],
  remote: ChangelogRelease[],
): ChangelogRelease[] {
  const seen = new Set(local.map((release) => release.tagName));
  return [...local, ...remote.filter((release) => !seen.has(release.tagName))];
}
