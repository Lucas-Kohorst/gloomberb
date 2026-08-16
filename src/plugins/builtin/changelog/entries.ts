import type { ChangelogRelease } from "../../../updater/github-releases";

export const HOSTED_CHANGELOG_RELEASE: ChangelogRelease = {
  id: "hosted-2026-08-16-hardening",
  tagName: "2026.08.16",
  version: "2026.08.16",
  title: "Security hardening, performance optimizations, and plugin search",
  publishedAt: "2026-08-16T13:00:00.000Z",
  url: "",
  body: `## Highlights

- URL scheme validation prevents \`file://\` and \`javascript://\` URLs from external feeds from opening local applications.
- Cloudflare Worker \`http.fetch\` now blocks private/internal IP ranges, closing an SSRF vector on the hosted client.
- Self-updater verifies SHA-256 checksums from GitHub release assets before installing binaries.
- Time-series transform and alignment algorithms optimized from O(n\u00b2) and O(n\u00d7m) to O(n log n) and O(n+m).
- \`gloomberb plugin-search <query>\` searches GitHub for installable plugins by keyword.

## Security

- \`openUrl\` and \`openExternal\` validate the URL scheme (\`http:\` / \`https:\` only) before spawning \`open\`, \`cmd\`, or \`xdg-open\`.
- Cloudflare Worker \`http.fetch\` blocks localhost, RFC-1918, and link-local addresses before proxying.
- Cloudflare Worker catch block maps known user-facing errors (auth, feature gates) and sanitizes all others to a generic message.
- \`Content-Security-Policy\` header on \`serveApp\` with \`default-src 'self'\`, \`connect-src 'self' https://api.gloom.sh\`, and \`frame-ancestors 'none'\`.
- Self-updater verifies SHA-256 digest from GitHub's release asset API before swapping the binary; backward compatible with older releases without digests.

## Performance

- \`referencePoint\` in yoy/qoq transforms uses binary search instead of linear scan (O(n\u00b2) \u2192 O(n log n)).
- \`alignTimeSeries\` carry-forward uses a moving pointer per series instead of re-scanning all points (O(n\u00d7m) \u2192 O(n+m)).
- \`mergePriceHistoryWindows\` uses a two-pointer merge of two sorted arrays instead of Map + full sort (O(n log n) \u2192 O(n)).
- \`useRemoteUiNode\` effect has a dependency array; 7 UI component callers wrap registrations in \`useMemo\`.
- DataTable \`useRemoteUiNode\` metadata (200-row slice) wrapped in \`useMemo\` to avoid per-render serialization.

## DX and tooling

- \`typecheck\` script now includes \`typecheck:cloud\` for the Cloudflare Worker.
- \`web-tree-sitter\` removed (zero imports across the codebase).
- \`.env.example\` documents \`GLOOMBERB_LANG\` and \`GLOOMBERB_CLOUD_HOSTED\`.
- \`catch (error: any)\` replaced with \`catch (error: unknown)\` across 12 IBKR catch blocks.
- Notes and broker persistence catch blocks now log errors instead of silently swallowing them.

## Plugin discovery

- \`gloomberb plugin-search <query>\` searches GitHub for repos with the \`gloomberb-plugin\` topic, falling back to a keyword search.
- Results show plugin name, stars, and description; install with \`gloomberb install <user/repo>\`.

## Tests

- Sync controller race-condition tests: runtime swap mid-pull, contributor apply failure, concurrent requestSync queuing, stale signature skip + force override.
- Time-series transform and alignment edge-case tests.
- \`mergePriceHistoryWindows\` dedup, override, Date normalization, and empty-input tests.
- Updater checksum verification tests: match, mismatch, and backward-compatible no-checksum cases.
- URL scheme validation tests for \`openUrl\`.
`,
};

export const HOSTED_CHANGELOG_RELEASE_PRIOR: ChangelogRelease = {
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

export function bundledChangelogReleases(): ChangelogRelease[] {
  return [HOSTED_CHANGELOG_RELEASE, HOSTED_CHANGELOG_RELEASE_PRIOR];
}

export function mergeChangelogReleases(
  local: ChangelogRelease[],
  remote: ChangelogRelease[],
): ChangelogRelease[] {
  const seen = new Set(local.map((release) => release.tagName));
  return [...local, ...remote.filter((release) => !seen.has(release.tagName))];
}
