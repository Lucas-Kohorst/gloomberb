import type { ChangelogRelease } from "../../../updater/github-releases";

const RELEASE_0_11_0: ChangelogRelease = {
  id: "hosted-v0-11-0",
  tagName: "v0.11.0",
  version: "0.11.0",
  title: "The web terminal: futures, AI benchmarks, TV replays, sharing, and a hosted client that loads",
  publishedAt: "2026-08-17T00:00:00.000Z",
  url: "",
  body: `Everything from the web terminal push, consolidated into one note. New panes, a hosted client that actually boots, TV that plays, sharing for charts and articles, a font size that scales the whole grid, and a long tail of fixes.

## Highlights

- The hosted web client no longer hangs on "Loading Gloomberb..." — and the bug class that caused it is now a CI check.
- New **Futures** board (\`FUT\`): 24 front-month contracts across equity index, rates, energy, metals, agriculture, and FX.
- New **AI benchmarks** pane (\`AIBENCH\`): live model rankings, context windows, price per million tokens, throughput.
- New **Plugin marketplace** (\`PLUGINS\`): enable and disable every installed plugin from one pane.
- TV plays again, with live streams, replays labelled with their air time, and two new channels.
- Share a chart, an article, or a changelog entry as a public link with \`y\`.
- \`FONT+\` / \`FONT-\` now scales the entire terminal grid, not a number nothing read.

## New panes

- **Futures** (\`FUT\`) — front-month contracts grouped into six sectors, with last price, session change, percent change, clickable header sort, and column visibility settings.
- **AI benchmarks** (\`AIBENCH\`) — llm-stats model rankings: intelligence scores, context windows, price per million tokens, throughput, sortable and searchable.
- **Plugin marketplace** (\`PLUGINS\`) — browse, enable, and disable installed plugins instead of hunting through settings.
- **SEC filings** — standalone browser of the latest 8-K / 10-K / 10-Q / S-1 / 13F filings.
- **Connections** — the inventory of every live integration with real request traffic.
- **API Keys** — add, edit, test, and delete keys, including custom URLs.
- **Polls** (VoteHub), **Adjacent indices**, **Adjacent rates**, and an **RSS** reader.

## Futures board

- 24 front-month contracts: ES, NQ, YM, RTY, ZT, ZF, ZN, ZB, CL, BZ, NG, RB, GC, SI, HG, PL, ZC, ZS, ZW, KC, SB, 6E, 6J, 6B.
- Every symbol was validated against the live provider before shipping; \`DX=F\` does not resolve and was left out, since the dollar index is already on the world indices board.
- Grains quote in US cents and are marked with a trailing \`c\` so they cannot be misread as dollars.
- Price precision scales to the contract: two decimals for index contracts, four to six for FX.
- Session change is scaled to the contract's price, so a four-tick move on an index future reads \`+4.25\` instead of \`+0.400098\`.
- Quote polling is shared with the world indices board rather than duplicated.

## Hosted web client

- **Fixed the hang on load.** The plugin loader read \`process.env\` at module scope, which throws in a browser before React mounts, leaving the page stuck on its loading placeholder. Resolution is now lazy.
- A CI check evaluates the real hosted bundle with \`process\` undefined, so the same class of failure fails a build instead of production.
- The Cloudflare Worker is now typechecked in CI. It was excluded from the typecheck chain, so Worker type errors passed CI and surfaced at deploy.
- \`sec\` opens the filings browser on hosted without asking for a ticker first.
- SEC EDGAR traffic routes through the hosted backend, so the browser is not blocked by CORS, and the EDGAR User-Agent carries a real contact address instead of a \`.local\` suffix.
- User layouts, plugin config, and RSS feeds persist per user and sync through Gloom Cloud; a stale cloud pull can no longer overwrite a newer local save.
- BYOK keys stay local and are never written into synced snapshots.
- On-device AI: the hosted client defaults to Chrome's built-in model when available, with real state (ready, needs download, downloading, unavailable), user-initiated downloads, and remote fallback.

## Terminal

- **Fixed a startup crash.** OpenTUI defines an empty \`window\` global, so \`typeof window !== "undefined"\` was true in the terminal with no DOM behind it and startup threw on a null \`pathname\`. Browser access now tests for the capability it needs instead of the binding.
- \`FONT+\` / \`FONT-\` scales the grid cell itself, so panes, tables, dialogs, and floating windows all grow and shrink together. 10–20px, persisted.

## TV

- Live resolution reads the stream from the channel live page's player payload, after YouTube stopped emitting the LIVE badge markup every channel relied on.
- Removed the deprecated \`/embed/live_stream\` fallback that produced "Error 153". An embed is only built from a concrete video id.
- Web embeds send the page's real HTTPS origin so YouTube identifies the client.
- A channel with no live stream plays its newest upload, labelled \`latest replay\` with the air time, reading both the old and new publish-time markup.
- Muting goes through the player API, so toggling sound no longer restarts the stream.
- Two channels added: Eventual and threadguy (\`1\`–\`7\`).
- Captions removed — the toggle never reliably reached the player.

## Charts and sharing

- Share a chart built with \`G\` using \`y\`: the spec travels behind a short \`/s/…\` link and rebuilds the exact chart for whoever opens it.
- Share a changelog entry with \`[y] share\`.
- Share any news, RSS, or Substack article with \`y\`, from the list, the detail view, or a popped-out reader.
- Shared links open for anyone, signed in or not — the payload travels in the URL and nothing is stored server side.
- A shared article link used to land on the login screen because anonymous sessions have onboarding incomplete; a valid payload now bypasses onboarding, while a malformed or undecodable one still falls through to the login gate.
- \`G AAPL:price / NVDA:price\` now plots only the derived line instead of also plotting both raw operands against a mismatched scale.
- Series suggestions appear as you type a \`G\` expression.

## News, articles, and reading

- News, RSS, and Substack readers pull full article text through the Jina reader instead of a summary and a link out.
- Ask the command bar for "article on …" or "news about …" and it searches enabled feeds plus Adjacent Press, offering an Open-article row.
- Article and headline queries run a local lookup, so the AI row no longer dead-ends when a local article already matched.
- Pop any article into its own floating pane with \`p\`.
- RSS feed subscriptions and a reader pane.

## SEC filings

- \`sec\` opens the standalone browser; \`SEC AAPL\` prefills the search.
- Latest 8-K / 10-K / 10-Q / S-1 / 13F filings from the last week, searchable by ticker, company, or form.
- The pane id is no longer classified as ticker-scoped, so it survives layout normalization instead of being silently dropped.

## Prediction markets, polls, and Adjacent

- Kalshi and Polymarket catalogs come from Adjacent's full market universe sorted by volume, so high-volume sports and politics show up instead of a thin elections sample.
- Kalshi 24h volume is contract count, not contracts multiplied by last price.
- Requests to an unrecognized URL are no longer attributed to Polymarket.
- Poll detail gains Overview, Trend, and Pollsters tabs, with a 5-poll moving average, sample-weighted pollster averages, \`[s]earch\`, and an estimated margin of error.
- Poll coloring: approve and yes render green, disapprove and no render red, across labels, values, and bars.
- \`ADJ <query>\` searches prediction markets by text; detail gains Similar and News tabs.
- Adjacent sits under **Data** in the command bar rather than under Gloom Cloud, is its own Connections entry, and needs no API key.

## Connections

- Every external API registers in the Connections pane and reports real request traffic.
- Adjacent, VoteHub polls, RSS, Kalshi, Polymarket, TV/YouTube, Yahoo, SEC EDGAR, llm-stats, and Gloom Cloud are all listed.
- Public sources say "Public — no key needed" instead of showing an auth warning.

## API keys (BYOK)

- Attach an OpenAPI 3.x or Swagger 2.0 spec by URL or paste: Gloomberb reads the server URL, derives the auth scheme from the security definitions, and probes a real side-effect-free GET instead of issuing a blind request.
- The spec catalog feeds the assist inventory, and failures name the cause — timeout, DNS, refused connection, TLS, 401, or an unexpected content type.
- Testing a custom API runs server side on hosted, so third-party CORS rules no longer block it.
- A passing test registers the key under its name in the command bar; opening it renders JSON as a table or key/value pairs, CSV as a table, and text as a scrollable body.

## Plugins and stability

- One broken module no longer takes down the app: each module of a composite plugin starts in isolation, a failure is logged, and the rest still register.
- Plugin readiness no longer aborts on the first rejection, and a stale \`gloomberb-cloud\` entry in \`disabledPlugins\` is stripped on load.
- The AI benchmarks pane was written but never registered, so it was unreachable from the command bar. It is now registered in both catalogs.
- Fixed the startup crash caused by stale nested OpenTUI packages after an in-place global upgrade, plus a packaged runtime regression check.
- Release, update, install, help, and repository links point at the \`gloom-sh\` organization.

## Security

- Only \`http\` and \`https\` links are handed to the OS opener. \`file:\`, \`javascript:\`, \`data:\`, \`smb:\`, and other schemes are rejected across every place the app can open a URL.

## Command bar, panes, and tables

- Opening a pane that is already on screen focuses the existing one instead of stacking a duplicate.
- Data tables sort on header click (asc/desc) and offer \`[s]earch\` when the list is long enough.
- Pane footers use consistent, working hints: \`[o]\`pen, \`[p]\`op out, \`[s]\`earch, \`[r]\`efresh — every hinted key is bound.
- Network-backed panes show an approximate \`updated ~5m\` that ticks up each minute.
- The Adjacent Indices \`7D\` column is no longer clipped: widths account for gutters and padding, and lower-priority metrics drop out at narrow widths. Same fix for Adjacent Rates and 13F holdings.
- Floating pane actions stay on one row, and pane bodies and tables stretch with the window.

## Portfolios and search

- Corrected IBKR average-cost handling for GBX and other sub-unit quotes, so P&L percentages are no longer inflated by roughly 100x.
- Ticker search preserves provider ranking while enriching saved tickers, keeps completed results ahead of provisional rows, and respects exact symbol, exchange, asset-class, fund, and alternate-listing intent.

## How to try it

- \`FUT\` for the futures board, \`AIBENCH\` for model benchmarks, \`PLUGINS\` for the marketplace.
- \`TV\`, then \`1\`–\`7\` for channels.
- \`G AAPL:price / NVDA:price\`, then \`y\` to share the chart.
- \`FONT+\` / \`FONT-\` to scale the whole terminal.
- Command bar: Changelog to reopen these notes.
`,
};

/** Newest first: the pane's default order and the GitHub merge both rely on it. */
export const HOSTED_CHANGELOG_RELEASES: ChangelogRelease[] = [
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
