import type { ChangelogRelease } from "../../../updater/github-releases";

const RELEASE_2026_08_16: ChangelogRelease = {
  id: "hosted-2026-08-16",
  tagName: "2026.08.16",
  version: "2026.08.16",
  title: "Hosted SEC and TV fixes, shareable articles, and Adjacent out of Gloom Cloud",
  publishedAt: "2026-08-16T18:00:00.000Z",
  url: "",
  body: `## Highlights

- \`sec\` opens the broad filings browser on the hosted web client instead of asking you to pick a ticker first.
- TV plays again — the deprecated YouTube embed that returned "Error 153" is gone.
- Share any news, RSS, or Substack article as a public link with \`y\`.
- Adjacent is no longer filed under Gloom Cloud, in the command bar or in Connections — and it needs no API key.

## Changes

### SEC

- The \`SEC\` shortcut was declared as requiring an argument, so a bare \`sec\` fell through to the ticker-research tab and asked you to select a ticker. It now opens the standalone browser directly; \`SEC AAPL\` still prefills the search.
- SEC EDGAR requests route through the hosted backend, so the browser is no longer blocked by CORS.

### TV

- Removed the deprecated \`/embed/live_stream?channel=\` fallback that produced "Error 153: Video player configuration error".
- Live streams embed a resolved video id and omit the \`origin\` parameter. A channel with no live stream shows a clear message instead of a broken player.

### Sharing articles

- \`y\` copies a public link to the selected article — from the list, the detail view, or a popped-out reader.
- Works for news, RSS, and Substack.
- The link opens for anyone, signed in or not. The article travels inside the URL, so nothing is stored server side.

### Adjacent

- Adjacent commands and panes now sit under **Data** in the command bar. They were showing under Gloom Cloud because plugin commands were grouped by their owning plugin instead of their declared category.
- Adjacent is its own entry in Connections rather than part of Gloom Cloud.
- **No API key is needed.** Adjacent uses public endpoints when no key is set, and Connections now says "Public — no key needed" instead of showing an auth warning.

### Prediction markets

- Requests to an unrecognized URL were attributed to Polymarket, which made its connection status misleading. Unmatched requests are no longer reported against any source.

### API Keys (BYOK)

- Testing a custom API works on the hosted client. The request runs server side, so third-party CORS rules no longer block it.
- Failures say what actually went wrong — timeout, DNS, refused connection, TLS, 401, or an unexpected content type — instead of a generic connection error.
- Testing a custom API now requires being signed in.

### Polls

- Poll detail gains Overview, Trend, and Pollsters tabs.
- Trend charts every historical poll for a subject with a 5-poll moving average.
- Pollsters lists every firm covering a subject with sample-weighted averages and poll counts.
- \`[s]earch\` filters by subject, pollster, or race type.
- Margin of error is estimated from sample size, because VoteHub does not publish it.

### Tables and layout

- The Adjacent Indices \`7D\` column is no longer clipped. Column widths account for gutters and padding, and lower-priority metrics drop out at narrow widths instead of overflowing.
- Same overflow fix applied to Adjacent Rates and 13F holdings.
`,
};

const RELEASE_2026_08_15_2: ChangelogRelease = {
  id: "hosted-2026-08-15-articles",
  tagName: "2026.08.15.2",
  version: "2026.08.15.2",
  title: "Command-bar articles, SEC filings, and the connections inventory",
  publishedAt: "2026-08-15T22:00:00.000Z",
  url: "",
  body: `## Highlights

- Ask the command bar for an article and it searches your enabled news/RSS feeds plus Adjacent Press, offering an Open-article row.
- \`sec\` now opens a standalone SEC filings browser — latest filings with search — instead of demanding a ticker first.
- The Connections pane is now the inventory of every live integration, with real request traffic, not just a Gloom Cloud status widget.
- Hosted settings (layouts, plugin config, RSS feeds) persist per user and sync through Gloom Cloud; BYOK keys stay local.

## Changes

### Command bar

- Type "article on …" or "news about …" and get matching articles from subscribed feeds plus Adjacent Press, each with an Open-article row.
- Article and headline queries run a local news/Adjacent lookup, so the AI row no longer dead-ends when a local article already matched.
- AI assist resolves article queries to the ART command and knows your enabled feed names.

### SEC filings

- \`sec\` opens a browser of the latest 8-K / 10-K / 10-Q / S-1 / 13F filings from the last week.
- Search by ticker, company, or form with \`/\` or the search bar.
- \`sec aapl\` (or any symbol) opens SEC with that search prefilled and loads the company's filings.
- Rows include the company name; the footer has \`/\` search, \`[r]efresh\`, and \`[o]pen\`.

### Connections

- Every external API registers in the Connections pane and reports real request traffic.
- Adjacent, VoteHub polls, RSS, Kalshi, Polymarket, TV/YouTube, Yahoo, SEC EDGAR, and Gloom Cloud are all listed.

### Adjacent

- \`ADJ <query>\` searches prediction markets by text.
- Prediction-market detail gains Similar and News tabs.
- The Indices table gains a ticker column, clickable header sort, and search.

### Hosted client

- User layouts, plugin config, and RSS feeds save per user and sync through Gloom Cloud; a stale cloud pull can't overwrite a newer local save.
- BYOK API keys stay local and are never written into synced snapshots.

### Data tables and footers

- Long tables sort when you click a column header (asc/desc) and offer \`[s]earch\`.
- Pane footers use consistent, working hints: \`[o]pen\`, \`[p]op out\`, \`[s]earch\`, \`[r]efresh\`.
`,
};

const RELEASE_2026_08_15: ChangelogRelease = {
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

/** Newest first: the pane's default order and the GitHub merge both rely on it. */
export const HOSTED_CHANGELOG_RELEASES: ChangelogRelease[] = [
  RELEASE_2026_08_16,
  RELEASE_2026_08_15_2,
  RELEASE_2026_08_15,
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
