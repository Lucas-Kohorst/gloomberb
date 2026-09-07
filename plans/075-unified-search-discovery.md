# Plan 075: Discover documents, chart series, and panes from ordinary search

## Status

- Priority: P1
- Effort: L, split into the three reviewable changes below
- Risk: MED (ranking, asynchronous results, hosted registration)
- Category: direction
- Depends on: none
- Planned at: `a3d283ce`, 2026-09-07
- Status: TODO; inspection and design only, no implementation in this pass

## Intended behavior

Search should expose what the application can open without requiring users to
know a source name or command prefix. Preserve explicit command routing.

| Query | Expected available action |
|---|---|
| `Kalshi filings` | Open matching CFTC filing details, preserving the selected filing |
| `ART Kalshi` / `SRCH Kalshi` | Include matching CFTC documents alongside existing eligible sources |
| `aave fees` | Chart Aave daily fees, labeled DefiLlama |
| `oil inventories` | Chart the matching FRED series |
| `life expectancy` | Offer available OWID series with country/dimensions shown |
| `AAPL revenue` | Chart Apple's revenue, with reporting frequency visible |
| `defillama` | Browse relevant series and open the applicable catalog view |

Documents, Chart Series, and Panes are distinct result sections. Exact commands
and symbols retain their fast path. Bound each section so news cannot crowd out
data. Preserve keyboard selection by result ID as asynchronous sections arrive.
Use existing clickable result rows. Opening a result must open the selected
document or resolved series, rather than merely repeat a broad search.

## Verified current state

- `src/plugins/builtin/research-search/command-bar-search.ts` already registers
  cloud News and Documents providers. Documents requests `transcript` and
  `filing`; the action opens SRCH and hands off the exact cloud hit.
- `src/api-client/types.ts` defines `CloudSearchDocType` as `transcript | news |
  filing`. No distinct CFTC adapter exists in research-search. Whether the
  remote corpus indexes any CFTC content has not been verified.
- `src/components/command-bar/routes/root/article-results.ts` separately searches
  CFTC only on filing/CFTC/DCM/DCO intent. It sends the raw command text to
  `loadCftcFilings`, then converts metadata into NewsArticle rows with empty URLs.
- `surface/index.tsx` opens CFTC results using
  `createPaneFromTemplate("cftc-filings-pane", { arg: rootQuery })`; the selected
  filing ID is lost.
- `src/plugins/builtin/adjacent/client.ts` supplies `listFilings` and
  `getFilingDetail`. Details contain markdown, source URL, and document URLs.
  This establishes metadata lookup and detail retrieval, not full-text indexing
  of every attachment.
- Root chart suggestions are gated by `looksLikeCatalogSeriesQuery` in
  `chart-composer/series-catalog.ts`, before catalog search. The catalog can
  resolve `aave fees`, `oil inventories`, `life expectancy`, and `AAPL revenue`
  while that gate rejects them. Existing tests even assert the last rejection.
- Catalog capability search already exists, but hosted disables capability
  invoke handlers. Declarative discovery must register independently of them.
- `routes/root/search-providers.ts` already handles provider debounce,
  cancellation, caching, and plugin disable filtering. Reuse this lifecycle.
- Assist inventory describes executable prefixes; extend its metadata from
  source/pane registrations without asking AI to invent series identifiers.
- Pane-template search already includes the owning plugin name, while
  `commands/plugin/items.ts` omits it from command search text. Preserve existing
  pane matching and fill that command metadata gap; prefixless panes remain
  discoverable locally even though Assist requires an executable prefix.

## Scope and constraints

Read `PLUGINS.md` before implementing. Primary scope is command-bar root search
and assist, research-search, adjacent filing adapters, chart-composer catalogs,
plugin registration/types, contributing built-in plugins, and their focused
tests. Reuse existing readers, result components, catalog expressions, connection
instrumentation, and source fetch paths.

Do not change chart calculations, remove Kitty support, change entitlement
checks, silently enable plugins, install plugins on selection, or add remote
indexing infrastructure in this frontend change. Do not pretend metadata search
is full-text attachment search. Keep BYOK secrets out of metadata and snapshots.
Push/open PRs only against Lucas-Kohorst/gloomberb via `fork`, based on fork main.

## Step 1: Bring CFTC into document discovery

Create a shared written-document adapter within research-search, retaining a
discriminated identity for cloud hits versus Adjacent CFTC IDs. Keep the cloud
wire type unchanged. Use this adapter in the command-bar Documents provider and
SRCH pane, with CFTC source/type filtering and independently bounded pagination.
Do not combine backend total counts as if they describe a single ranked index.

Normalize command/intent terms before CFTC lookup; retain meaningful query terms
and source filters separately. Route ART through this same document discovery
path where applicable and remove duplicate legacy CFTC searches. Debounce remote
metadata queries, ignore stale responses, and preserve working results if one
source fails. Explicit SRCH must expose source failures instead of claiming an
empty successful search. Respect disabled plugins and existing auth boundaries.

On selection, fetch that CFTC ID's detail and display its markdown and source
links using the existing document-reader presentation. Keep external open and
document links working. Do not fetch every attachment while typing. Saved source
filters need a backward-compatible local representation; do not send unsupported
CFTC types to the cloud saved-search API or promise cloud alerts for them.

Verify with focused tests in `research-search/command-bar-search.test.ts`,
`research-search/model.test.ts`, `research-search/document-view.test.tsx`, and
`command-bar/routes/root/article-results.test.ts`: normalized ART/filing input,
selected-ID handoff, overlapping results, source failure, and stale responses.
Run `bun test src/plugins/builtin/research-search src/components/command-bar/routes/root/article-results.test.ts`;
expect exit 0. Full-text CFTC attachment indexing is a separate backend follow-up
after establishing the ingestion and search contract.

## Step 2: Search source-owned series catalogs

Add lifecycle-owned declarative chart catalog contributions to the existing
plugin registry, independent of capability invoke handlers. Each contribution
owns stable series IDs, labels, aliases, source, dimensions/units/frequency when
known, canonical chart expressions, and optional abortable remote lookup.
Adapt existing catalog providers; avoid creating a second list of the same
series inside command-bar code.

Build a cheap local metadata search used by root search, CAT, and G. Search it
for ordinary queries rather than requiring a central source-specific regex.
Only query remote catalogs when their metadata or explicit source intent makes
them relevant. Do not download chart histories while typing. Deduplicate by
canonical series identity; honor unregister/disable and hosted lifecycles.
Keep expression completion, ratios, and CORR eligibility intact.

First migrate DefiLlama and the existing FRED/OWID catalogs, then remaining
catalog contributors within this change. Source registration should be enough
to make a new catalog discoverable without editing root search. Avoid guessed
charts for ambiguous queries: show concrete alternatives with their dimensions.

Verify `aave fees`, `oil inventories`, `life expectancy`, and `AAPL revenue`
produce actual root chart actions. Add boundary tests for hosted registration,
disabled plugins, late responses, duplicate IDs, and existing G/CORR expressions.
Run `bun test src/components/command-bar/routes/root/series-suggestions.test.ts src/plugins/builtin/chart-composer`;
expect exit 0, updating tests that intentionally encode the obsolete gate.

## Step 3: Expose panes and keep ranking coherent

Use installed plugin commands and pane-template descriptions/keywords to expose
their useful actions, even when a user searches a topic rather than a shortcut.
Include the owning plugin name in command search text and assist descriptions.
Reuse the registry and indexed-results machinery. A plugin with several panes
should offer the matching pane rather than an ambiguous generic open action.
Disabled plugins may offer a clear enable/settings action, never an action that
looks executable while disabled. Third-party marketplace discovery is deferred.

Derive assist hints from the same registered actions and catalog metadata.
Preserve prefix-based execution and deterministic local results when assist is
unavailable. Bound category results, deduplicate legacy/provider overlap, and
preserve selection identity while sections arrive. Include source, units, and
frequency where they distinguish series; do not repeat redundant labels.

Run `bun test src/components/command-bar/routes/root src/components/command-bar/assist`;
expect exit 0. Keep tests focused on routing, ranking, and lifecycle regressions.

## Final verification and completion

- Run `bun run typecheck`; all six targets must exit 0.
- Run the focused suites above after the final integrated change.
- Use the `tui-testing` skill and an owned tmux session to exercise the query
  table, select a CFTC document and chart result, test keyboard/mouse selection,
  then kill that session. Never kill unrelated user sessions.
- Verify hosted/web source registration and the same result actions with the
  available browser QA tooling; terminal-only success is insufficient.
- Review the diff against the scoped changes and update this plan/index status.

Before implementation run `git diff --stat a3d283ce..HEAD -- src/components/command-bar src/plugins src/types/plugin.ts`.
Compare changed search contracts with this plan before applying it. Stop and
report if required backend full-text behavior is unavailable, existing pane
adapters cannot represent selected CFTC details without a larger redesign, or
verification remains failing after two focused repair attempts. Do not hide
these problems by weakening entitlement, removing tests, or fabricating results.
