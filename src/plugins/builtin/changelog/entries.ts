import type { ChangelogRelease } from "../../../updater/github-releases";

const RELEASE_0_11_0: ChangelogRelease = {
  id: "hosted-v0-11-0",
  tagName: "v0.11.0",
  version: "0.11.0",
  title: "Chat and plugin resilience, TV replays, real font scaling, chart and changelog sharing",
  publishedAt: "2026-08-17T00:00:00.000Z",
  url: "",
  body: `A consolidated release: hosted SEC and TV fixes that finally hold, sharing for charts and changelog entries, two new panes, a font size that scales the whole terminal, and a plugin loader that no longer lets one bad module take the app down with it.

## One broken module no longer takes down the app

Chat, Adjacent, and the rest of the Gloom Cloud integration ship as modules of a single composite plugin. If any one module threw while starting up, the registry rolled back the *entire* plugin — so one unrelated failure silently removed chat and everything next to it. Each module now starts in isolation: a failure is logged and the remaining modules still register. Plugin readiness no longer aborts on the first rejection, and a stale \`gloomberb-cloud\` entry left behind in \`disabledPlugins\` is stripped on load.

## TV: live streams, and replays with their air time

YouTube stopped emitting the LIVE badge markup the resolver relied on, so every channel reported offline. Live resolution now reads the stream out of the channel live page's player payload. The deprecated \`/embed/live_stream\` fallback that produced Error 153 is gone; an embed is only ever built from a concrete video id, and web embeds send the page's real HTTPS origin so YouTube identifies the client.

A channel with no live stream plays its newest upload, labelled \`latest replay\` with the air time. YouTube moved that markup too — the publish time left \`publishedTimeText\` for a newer metadata block — so the parser now reads both shapes. Muting goes through the player API instead of rebuilding the embed URL, so toggling sound no longer restarts the stream. Two channels join the grid: Eventual and threadguy (\`1\`–\`7\`).

Captions are gone. The toggle never reliably reached the player, and a footer hint that does nothing is worse than no hint at all.

## Font size scales everything

\`FONT+\` / \`FONT-\` persisted a number that nothing ever read. The web client measures every pane, table, dialog, and floating window in grid cells, so the cell itself now scales with the font size and the whole terminal grows and shrinks together. 10–20px, persisted across sessions.

## Share a chart or a changelog entry

Charts built with \`G\` share with \`y\`, the same as articles: the chart spec travels behind a short \`/s/…\` link and rebuilds the exact chart for whoever opens it. Reading a changelog entry now offers \`[y] share\` beside refresh, producing a public link that opens for anyone, account or not.

## A derived chart plots the derived line

\`G AAPL:price / NVDA:price\` built the ratio study but still plotted both raw operands, flattening the ratio against a mismatched scale. A binary expression now hides its operands and plots only the result.

## Two new panes

- **AI benchmarks** (\`AIBENCH\`) — live model rankings from llm-stats: intelligence scores, context windows, price per million tokens, and throughput, with sortable columns and search.
- **Plugin marketplace** (\`PLUGINS\`) — browse, enable, and disable every installed plugin from one pane instead of hunting through settings.

## Articles render in full

The news, RSS, and Substack readers pull full article text through the Jina reader instead of showing a summary and a link out. It is registered as its own Connection like every other external source.

## SEC opens on the hosted client

\`sec\` opens the standalone filings browser without a ticker — \`SEC AAPL\` still prefills the search. The pane id is no longer classified as ticker-scoped, so it survives layout normalization instead of being silently dropped. EDGAR traffic routes through the hosted backend (no browser CORS), and the EDGAR User-Agent carries a real contact address derived from the deployment host instead of a \`.local\` suffix, so SEC stops blocking the requests.

## Shared articles open for anyone

A shared article link used to land on the Gloom Cloud login screen, because anonymous sessions have onboarding incomplete. A link carrying a valid, decodable payload now bypasses onboarding and opens the reader for anyone. The bypass is strict: a wrong path or a missing, malformed, or undecodable payload falls through to the normal login gate. Signed-in readers keep their workspace exactly as it was.

## BYOK understands your API

Testing a custom API used to issue a blind GET and demand a 2xx. You can now attach an OpenAPI 3.x or Swagger 2.0 spec, by URL or pasted; Gloomberb reads the server URL, derives the auth scheme from the security definitions, and probes a real side-effect-free GET endpoint. The spec catalog feeds the assist inventory, and failures name the cause.

## On-device AI on the web client

The hosted web client defaults to Chrome's built-in on-device model when the browser has it, so prompts stay on your machine. AI settings shows the real model state: ready, needs download, downloading, or unavailable. Downloads are user-initiated, on-device is text only with remote fallback, an explicit provider choice is never overridden, and the option is hidden outside the hosted web client.

## Command bar and panes

- **No more duplicate panes.** Opening a pane that is already on screen — same pane id, binding, params, and settings — focuses the existing one instead of stacking a copy.
- **Series suggestions.** Typing a \`G\` expression suggests matching series as you go.
- **Poll coloring.** Approve and yes render green, disapprove and no render red, across labels, values, and bars.
- **Footer freshness.** Network-backed panes show an approximate \`updated ~5m\` that ticks up each minute.

## Adjacent

Adjacent commands and panes sit under **Data** in the command bar rather than under Gloom Cloud. Adjacent is its own Connections entry and needs no API key — public endpoints are used when no key is set.

## Polls, prediction markets, and tables

Poll detail gains Overview, Trend, and Pollsters tabs, with a 5-poll moving average, pollster sample-weighted averages, \`[s]earch\`, and an estimated margin of error. Requests to an unrecognized URL are no longer attributed to Polymarket. The Adjacent Indices \`7D\` column is no longer clipped: column widths account for gutters and padding, and lower-priority metrics drop out at narrow widths, the same for Adjacent Rates and 13F holdings.

## How to try it

- \`TV\`, then \`1\`–\`7\` for channels.
- \`G AAPL:price / NVDA:price\`, then \`y\` to share the chart.
- \`AIBENCH\` for model benchmarks, \`PLUGINS\` for the marketplace.
- \`FONT+\` / \`FONT-\` to scale the whole terminal.
- Changelog, open an entry, then \`y\` to share it.
`,
};

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
  RELEASE_0_11_0,
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
