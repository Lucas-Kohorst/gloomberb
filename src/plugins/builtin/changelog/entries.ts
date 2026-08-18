import type { ChangelogRelease } from "../../../updater/github-releases";

const RELEASE_0_12_1: ChangelogRelease = {
  id: "hosted-v0-12-1",
  tagName: "v0.12.1",
  version: "0.12.1",
  title: "News roll-in and blocked-reader fallback",
  publishedAt: "2026-08-18T01:30:00.000Z",
  url: "",
  body: `News rows briefly roll in when they arrive, and the article reader stays useful when publishers block automated extraction.

## News

- New headlines in firehose, RSS wire, breaking, industry, presets, and ticker news briefly roll in after the first silent hydrate (terminal row tint; web/desktop opacity/brightness).
- Arrival tracking keys on stable article ids so filter hide/show does not re-animate already-seen rows.

## Reader

- When Jina or the publisher returns 403/blocked (common on Investing.com and similar), show a clear “full text unavailable” empty state with RSS-summary fallback when present, instead of a raw \`Reader request failed (403)\`.
- Footer keeps a short status (\`blocked\`) plus \`[r]\`efresh / \`[o]\`pen / \`[y]\` share — no duplicated error string in the body and footer.
- Same path covers the terminal reader, Substack reader, and public article share pages.
`,
};

const RELEASE_0_12_0: ChangelogRelease = {
  id: "hosted-v0-12-0",
  tagName: "v0.12.0",
  version: "0.12.0",
  title: "Alt-data panes, denser news wire, and security hardening",
  publishedAt: "2026-08-18T00:00:00.000Z",
  url: "",
  body: `Security, performance, and discovery work from the improve cycle, plus Treasury auctions and a much denser RSS firehose. Bond search and VIX term-structure panes are built but stay hidden until the Gloom Cloud FRED proxy allowlists their series.

## Panes

- **Treasury auctions** (\`AUCT\`) from Treasury Fiscal Data — Bills, Notes, Bonds/TIPS with sortable auction tables.
- **Plugin discovery** pane — search GitHub for Gloomberb plugins and install from the command bar / pane UI.
- **Bond search** and **Volatility / VIX term structure** panes are implemented and connection-registered, but gated off until the hosted FRED proxy allowlists their series ids (no empty-table ship).
- Plans for Godel Terminal parity follow-ups: short interest, dividend yield, market halts, IPO calendar, Black-Scholes calculator (\`plans/025–029\`).

## News & shares

- Default RSS wire expanded from ~33 to **335** feeds across wires, national papers, sector trades, government/central-bank releases, tech/AI, energy, healthcare, crypto, and geopolitics.
- Share links use short \`/s/{id}\` ids; article shares join the same KV-backed path charts and tables already used.

## Security & reliability

- URL scheme validation before opening external links (http/https only).
- Cloudflare Worker: CSP header, SSRF protections on \`http.fetch\`, stricter Origin checks on the Gloom Cloud proxy, sanitized error responses, BYOK keys endpoint requires auth.
- Updater verifies SHA-256 checksums before installing a new binary.
- Surfaced previously swallowed persistence errors in notes and broker modules.

## Performance

- Chart time-series: O(n log n) reference-point lookup, O(n+m) alignment carry-forward, O(n) price-history window merge.
- DataTable remote-ui metadata memoized; \`useRemoteUiNode\` registration effect has a real dependency array.
- Linear grouping for statement merges; Adjacent client cache reuse fixed.

## DX & polish

- Knip + Cloudflare Worker typecheck in CI; dead deps removed; \`.env.example\` completed.
- Sync controller race-condition tests; consistent empty/error states (no unbound retry hints).
- Crypto price symbols skip empty bases; IBKR catch blocks typed as \`unknown\`.
`,
};

const RELEASE_0_11_0: ChangelogRelease = {
  id: "hosted-v0-11-0",
  tagName: "v0.11.0",
  version: "0.11.0",
  title: "Web terminal: panes, shares, charts, and a hosted client that loads",
  publishedAt: "2026-08-17T00:00:00.000Z",
  url: "",
  body: `One release note for the hosted web terminal ship.

## Panes

- **Futures** (\`FUT\`), **AI benchmarks** (\`AIBENCH\`), **Plugins**, **SEC filings**, **Connections**, **API Keys**, **Polls**, Adjacent indices/rates, and **RSS**.
- TradingView charts with universal series expressions, plus prediction-market series (\`G KALSHI:…\` / \`G POLY:…\` / \`G ADJ:…\`) from venue-direct Kalshi/Polymarket catalogs with native ticker/event/series resolution and a visible TICKER column. Market price history lives in its own **Chart** tab so Overview leads with outcomes.
- News/article reader with command-bar article lookup; firehose with sortable/searchable Origin and Substack bodies; TV live and labelled replays.
- Slim public share pages for articles, charts, and tables at short \`/s/{id}\` links (~12 chars) instead of booting the full terminal. Legacy \`/article?a=…\` links still open.

## Features

- Hosted client boots reliably; layouts and plugin config persist per user and sync via Gloom Cloud (BYOK keys stay local). On-device AI when Chrome’s model is available.
- Share charts, articles, and changelog entries with \`y\`. Open in terminal; logged-out visitors must sign up (Skip hidden). Share chrome matches the terminal pane (grip, title, \`[o]\`pen).
- Chart quick-add understands Ask-AI-style natural language into series expressions. Faster Jina article fetches with shared boilerplate sanitization and clean-summary fallback across reader, popout, and slim share.
- Expanded curated RSS defaults; Substack auth auto-refreshes. Faster Adjacent Similar/News matching with article links; prediction detail pauses polling on static tabs.
- \`FONT+\` / \`FONT-\` scale the whole grid. Pane suggestions in the header; version lives in the status bar.

## Fixes

- Loading hang and terminal startup crashes; TradingView pan stutter; Mac trackpad pinch/scroll zoom on charts, now far less sensitive per swipe.
- Status bar version / @user / delayed chip no longer clips; click the version to open Changelog. Suggestions strip spacing cleaned up.
- Share link hangs and 502s; local AI status no longer stuck on checking; Tab, Ctrl+N, and arrow navigation on web.
- EDGAR/CORS on hosted, broken Adjacent Indices search, IBKR GBX P&L, and non-\`http(s)\` URL schemes rejected at open.
- JSON-cached prediction history revives \`Date\` values so chart ranges plot correctly.
`,
};

/** Newest first: the pane's default order and the GitHub merge both rely on it. */
export const HOSTED_CHANGELOG_RELEASES: ChangelogRelease[] = [
  RELEASE_0_12_1,
  RELEASE_0_12_0,
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
