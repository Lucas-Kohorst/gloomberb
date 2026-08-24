# Plan 047: Filter PM locally on keystroke, debounce only remote

> **Executor instructions**: Do not blank the table while remote search runs.
> Reuse `fuzzyFilter` from `src/utils/fuzzy-search.ts`.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/prediction-markets/controller src/plugins/prediction-markets/metrics.ts src/plugins/prediction-markets/services/kalshi/adapter.ts src/plugins/prediction-markets/services/polymarket/adapter.ts src/utils/fuzzy-search.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (land after 046 if sharing the controller)
- **Category**: perf
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

PM search waits 250ms **then** refetches the whole catalog. Visible rows
filter on the **debounced** query (`controller/data.ts`). Kalshi search is
not a search API: 4×200 event pages then substring. Polymarket
`public-search` then hydrates **every** event before first paint.

Local matcher is contiguous `searchText.includes(normalizedQuery)` —
`"fed rates"` misses `"will the fed cut rates?"`.

## Current state

```214:226:src/plugins/prediction-markets/metrics.ts
const normalizedQuery = searchQuery.trim().toLowerCase();
return market.searchText.includes(normalizedQuery);
```

```272:281:src/plugins/prediction-markets/controller/catalog.ts
// 250ms debounce before debouncedSearchQuery
```

Shared fuzzy (`src/utils/fuzzy-search.ts`): lowercased exact → token exact →
prefix → substring → subsequence. Used by command-bar, **not** PM.

Polymarket: `services/polymarket/adapter.ts:121-140`.
Kalshi: `services/kalshi/adapter.ts:173-191`.

Footer shows `searching`; empty local+pending shows a full-pane spinner
(`pane.tsx:82-85`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/prediction-markets src/utils/fuzzy-search.ts` | pass |

## Scope

**In scope**
- `controller/catalog.ts`, `controller/data.ts`, `controller/index.ts`
- `metrics.ts` (`filterPredictionMarkets`)
- `services/polymarket/adapter.ts` (render search hits before hydrate)
- `services/kalshi/adapter.ts` only if desktop still pages 4×200 on search
- `pane.tsx` spinner condition
- tests

**Out of scope**
- Command-bar PM results (049)
- Adjacent search param fixes (042)
- Changing fuzzy-search.ts scoring unless a PM test proves it is wrong

## Git workflow

- Branch: `fix/pm-instant-search`
- Commit: `fix(pm): fuzzy-filter catalog immediately and hydrate search in background`

## Steps

### Step 1: Local filter on live query

`filterPredictionMarkets` / row filter uses **live** `searchQuery`, via
`fuzzyFilter` on `searchText` + ticker.

Token-AND: split query on whitespace; each token must fuzzy-match (so
`"fed rates"` works). Implement in `metrics.ts` using `fuzzyFilter` per
token or a small wrapper next to it.

**Verify**: unit test in `metrics` or plugin tests: `"fed rates"` hits a
Fed-cut market in a fixture; `"BITCON"` hits bitcoin via subsequence if
that is how `fuzzyMatch` works — assert the actual `fuzzyFilter` behavior,
do not invent scores.

### Step 2: Debounce only remote

Keep 250–400ms debounce **only** for `loadCatalog({ search })`.
Do not change cache key / do not clear `allRows` when the live query
changes.

Spinner only if local hits empty **and** remote pending. Otherwise keep
rows + footer `searching`.

**Verify**: controller test or pane test with fake timers: typing does not
await fetch to show a local hit.

### Step 3: Polymarket first paint

`public-search` events should become rows **before** `loadPolymarketEvent`
hydration. `reconcilePolymarketSearchEvents` already exists — use it so
search does not `Promise.all` hydrations on the critical path.

**Verify**: adapter test: search resolves with events even if hydrate
rejects/delays.

### Step 4: Kalshi search

If 043 landed hosted Adjacent search, desktop Kalshi should filter the
**already loaded** browse catalog locally and at most fetch 1 extra page,
not 4 blocking pages.

**Verify**: kalshi adapter search does not request 4 pages when a local
catalog exists.

## Test plan

- Local filter without fetch.
- Typo subsequence if `fuzzyFilter` supports it.
- Remote merge does not drop local rows.
- Pattern: `src/plugins/prediction-markets/plugin.test.tsx`, adapter tests.

## Done criteria

- [ ] Visible rows update from live query (not only `debouncedSearchQuery`)
- [ ] `filterPredictionMarkets` no longer requires contiguous full-string match
- [ ] Polymarket search test does not wait on full hydrate
- [ ] `bun test src/plugins/prediction-markets` passes
- [ ] `plans/README.md` row 047 → DONE

## STOP conditions

- `fuzzyFilter` on thousands of rows is slow in a test (>50ms for 2k) —
  then token-AND `includes` locally and keep fuzzy for short lists; report.
- Polymarket public-search payload cannot build a row without hydrate —
  show question + id from search hit with placeholders, still no spinner.

## Maintenance notes

While query is non-empty, sort by fuzzy rank then volume — do not fight the
user’s sort header; if a column sort is active, keep it (header sort wins).
