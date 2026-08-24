# Plan 048: TOP is first 10 of WIRE; Title Case categories; PM news is a news table

> **Executor instructions**: Reuse `NewsArticleStackView` and
> `useNewsArticleFooter`. Do not fork a third article list.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/builtin/news src/plugins/prediction-markets/detail/adjacent-tabs.tsx src/plugins/builtin/adjacent/prediction-integration.tsx src/plugins/builtin/adjacent/news.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/042-adjacent-auth-paths.md (news paths)
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

TOP is a **separate** `{ feed: "top", limit: 50 }` query sorted by
importance, not “top 10 from WIRE”. Adjacent latest vs list endpoints
diverge. User: TOP should be the top 10 from WIRE.

News categories show mixed `Economy` vs `tech` because display uses raw
`categories[0]`.

PM related news is a 2-line mouse list (`AdjacentMarketNewsView`) without
sort, `[o]`/`[p]`/`[a]`, or keyboard. AGENTS.md: news panes must use the
shared reader + table.

## Current state

```18:20:src/plugins/builtin/news/wire/news/query-presets.ts
top: { feed: "top", limit: 50 }
feed: { feed: "latest", limit: 200 }
```

TOP pane: `src/plugins/builtin/news/wire/index.tsx` uses `NEWS_QUERY_PRESETS.top`
and `defaultSort: { columnId: "importance", direction: "desc" }`.

Aggregator `getTopStories()` exists (`aggregator.ts`) but TOP does not call it.

Categories: `news/wire/news/table.tsx` `case "categories"` returns
`item.categories[0]`. Classifier labels are lowercase
(`wire/categories.ts`). RSS keeps publisher case.

PM: `detail/adjacent-tabs.tsx` + `prediction-integration.tsx:136-164`.
Canonical table: `NewsArticleStackView` (`news/wire/news/table.tsx`).
Footer: `useNewsArticleFooter` (`[o]` `[p]` `[a]`).
Normalize: `normalizeAdjacentNewsArticle`.

Keyboard: parent PM `handleKeyboard` returns early on detail except
overview / data — news tab must pass keys through like `data`
(`controller/keyboard.ts:139-140`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/builtin/news src/plugins/prediction-markets/detail src/plugins/builtin/adjacent` | pass |

## Scope

**In scope**
- `src/plugins/builtin/news/wire/news/query-presets.ts`
- `src/plugins/builtin/news/wire/index.tsx` (TOP template)
- category display helper + `table.tsx` / reader
- `src/plugins/prediction-markets/detail/adjacent-tabs.tsx`
- `src/plugins/prediction-markets/detail/pane.tsx` / `controller/keyboard.ts` / parent `pane.tsx` footer yield
- `src/plugins/builtin/adjacent/prediction-integration.tsx` (delete or stop using the 2-line list for PM)
- tests

**Out of scope**
- Changing Firehose
- Adjacent indices 2-line news (optional follow-up; user asked PM tab)
- New news sources

## Git workflow

- Branch: `fix/news-top-and-pm-tab`
- Commits: `fix(news): TOP is first 10 of WIRE`, `fix(news): title-case categories`, `fix(pm): related news uses NewsArticleStackView`

## Steps

### Step 1: TOP = first 10 of latest

Change TOP query to the same `feed: "latest"` stream as WIRE, `limit: 10`,
default sort **time desc** (not importance). Simplest: TOP pane watches the
same latest query and slices 10, or `NEWS_QUERY_PRESETS.top = { feed: "latest", limit: 10 }`.

Do not call Adjacent `getNews` vs `getLatestNews` as two feeds.

**Verify**: TOP template query equals WIRE’s feed with limit 10. Test the
preset object; skip copy tests.

### Step 2: Title Case categories at display

Add `formatNewsCategory(label: string)` (Title Case words). Use it in the
table cell and reader. Do not rewrite RSS ingest (keep publisher strings in
data; display is normalized). Query keys stay lowercase.

**Verify**: `"tech"` → `"Tech"`; `"health care"` → `"Health Care"`;
already `"Economy"` stays `"Economy"`.

### Step 3: PM news tab = news stack

Replace `AdjacentMarketNewsView` with `NewsArticleStackView` +
`useNewsArticleFooter` + `usePopOutNewsArticle` / `useArticleArchiveAction`.
Map `getMarketNews` → `normalizeAdjacentNewsArticle[]`.

Columns: same as News Feed (`time`, `source`, `title`, `tickers`, `categories`).
`[o]` bound. `[p]` pop out to shared reader. `[a]` archive.

Parent footer yields while news tab focused (nested footer id
`prediction-markets-news`). Pass keyboard through on `detailTab === "news"`.

Register articles so ART can see them if there is an existing stash/register
helper — only if one exists; do not invent a global store.

**Verify**: detail test: news tab renders table headers; Enter/`[o]` wired.
Do not screenshot.

## Test plan

- Preset top feed/limit.
- `formatNewsCategory` unit test (worth keeping).
- PM news tab uses stack view (render test already used in news table).
- Pattern: `src/plugins/builtin/news/wire/news/table.tsx` tests if present.

## Done criteria

- [ ] `NEWS_QUERY_PRESETS.top.feed === "latest"` and `limit === 10`
- [ ] Category cell uses the formatter
- [ ] `AdjacentMarketNewsView` is not used by PM detail
- [ ] `bun test` filters above pass
- [ ] `plans/README.md` row 048 → DONE

## STOP conditions

- TOP is used by cloud clients as importance ranking — grep `feed: "top"`
  consumers; if something besides the TOP pane depends on importance, keep
  that query id and only change the TOP **pane**.
- Nested footers fight and there is no yield API — report; do not hide `[o]`.

## Maintenance notes

Public Adjacent related news is max 3 and 24h old. Auth related news is the
full ranked list (042). UI should still work with 0–3 rows.
