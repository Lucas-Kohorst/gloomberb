# Plan 041: Aug 24 terminal fixes batch (index)

> **Executor instructions**: This file is the batch map, not an implementation
> plan. Do not land a single mega-PR. Execute **042–055** as separate branches
> against `fork` (Lucas-Kohorst/gloomberb). Never target upstream `origin` /
> `gloom-sh/gloomberb` with a PR.
>
> **Drift check**: `git rev-parse --short HEAD` should be `9016c08e` or a
> descendant. Plans were written against `9016c08e` on 2026-08-24 in worktree
> `/Users/lucas/Desktop/Work/project/gloom-pm-batch` on branch
> `plan/pm-terminal-fixes-aug26`.

## Status

- **Priority**: P1
- **Effort**: L (the batch; each child is S–M)
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this batch exists

Lucas filed these as one notes dump (8/22 and 8/24). They cluster into
prediction-markets, Adjacent/Kalshi, search/news, tables, hosted crash, and
zero-config Chrome AI. Several look like new product work; most are
already-half-built paths that miss a last wire (Chrome Prompt API exists but
is not the run host; similar markets already know the auth path but hosted
still hits `/public/.../similar`).

## What is already true on `9016c08e` (do not re-do)

- PM watchlist **Enter expands a grouped event** — covered by
  `src/plugins/prediction-markets/pane.test.tsx`. Follow-up is auto-select
  first row after tab switch (042 leftover, in 046).
- PM Data tab already has **Settles to + Suggested data feeds** chrome.
  Matching quality is still weak (054).
- `getSimilarMarkets` already builds `/markets/{id}/similar` (auth). Production
  400s that still show `/public/markets/.../similar` are an older bundle **or**
  another caller still using `marketsPath()`.
- Adjacent theme exists (`themes.adjacent`) but is not the default.
- `compareSortValues` already nulls-last; `"—"`, `"-"`, `""` still sort as
  strings.
- Chrome Prompt API adapter exists (`createBrowserAiRunHost`) with **no
  callers**.

## Execution order

Wave 1 — hosted breakage (can ship independently, highest user pain):

1. **042** Adjacent similar + news 400s (auth paths, query params)
2. **044** Hash `web-main.js` + real 404 for missing JS chunks
3. **045** Wire Chrome built-in AI as the hosted `AiRunHost`

Wave 2 — PM daily use:

4. **046** Density, keyboard, event ticker `-`, catalog footer poll, first-row select
5. **047** Instant local fuzzy PM search
6. **043** Hosted Kalshi catalog via Adjacent (keep CORS proxy for books)

Wave 3 — news / search / chrome:

7. **048** TOP = first 10 of WIRE; category Title Case; PM related news as news table
8. **049** Case-insensitive/fuzzy lists + command-bar `aapl` is a ticker first

Wave 4 — shared hygiene / later product:

9. **050** NA/`-` always sorts last; remaining tables get real header sort
10. **051** Default theme Adjacent (app + share page)
11. **052** ESG Yahoo empty-module handling
12. **053** Watchlist as a PORT/analytics collection; ETF flows spike
13. **054** Settlement series matcher quality
14. **055** Command bar + Portfolio Analytics visual cleanup

## Parallelism

- 042 ∥ 044 ∥ 045 (different files)
- 046 ∥ 047 once 042 is in if they both touch `prediction-markets/controller`
  — prefer 046 then 047 on one branch if one executor
- 043 after 042 (same Adjacent client + Kalshi adapter)
- 048 after 042 (news paths)
- 049 independent of PM except shared `fuzzyFilter`
- 050 is a wide table sweep — keep off PM-hot branches
- 051/052/055 independent
- 053 ETF flows is a **new data source** — spike first, do not invent a vendor

## Extra venues (not a plan)

Adjacent and PM types are hard-coded `kalshi | polymarket`. A third venue is
an L-track: adapter + `PredictionVenue` + `registerConnectionSource`. Do not
start it in this batch.

## Git

- Remote: `fork` only
- Branch names: `fix/adjacent-auth-paths`, `fix/hosted-web-main-hash`,
  `feat/hosted-browser-ai`, `fix/pm-pane-density`, etc.
- Commits: conventional (`fix(adjacent): …`, `feat(pm): …`)
