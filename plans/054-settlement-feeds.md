# Plan 054: Rank settlement series plus suggested CAT feeds

> **Executor instructions**: Keep the Data tab chrome. Improve
> `matchSettlementSeries` precision. Prefer no match over a wrong FRED
> series on an election market.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/prediction-markets/detail/settlement-match.ts src/plugins/prediction-markets/detail/data-tab.tsx src/plugins/prediction-markets/detail.test.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

Data tab already shows **Settles to** + **Suggested data feeds**
(`detail/data-tab.tsx`). Matcher is a small alias blob
(`settlement-match.ts`): weather, ~7 FRED series, 4 coins, VoteHub if
“poll”. User wants what it settles to **and** suggested feeds (CAT / FRED
/ Yahoo / rates).

## Current state

Tests: `settlement-match.test.ts` (weather, CPI, BTC), `detail.test.tsx`.
`resolutionSource` / rules text often names “BLS CPI-U” without `CPIAUCSL`.

CAT series live in `src/plugins/builtin/chart-composer/`. Reuse
`listKnownFredSeries` / prediction-series helpers if present
(`chart-composer/prediction-series.ts`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/prediction-markets/detail src/plugins/prediction-markets/detail/settlement-match.test.ts` | pass |

## Scope

**In scope**
- `settlement-match.ts` + tests
- `data-tab.tsx` only if settlement-only vs feed rows need splitting
- optional read of CAT inventory — do not load every OWID series

**Out of scope**
- User “pin this feed” persistence
- LLM matching
- Changing `[g]` chart pop-out

## Git workflow

- Branch: `feat/pm-settlement-matcher`
- Commit: `feat(pm): rank settlement series and catalog feed suggestions`

## Steps

### Step 1: Always surface settlement text

Even with zero series, show `resolutionSource` / a one-line rules snippet
as the settlement row.

**Verify**: fixture with rules “resolves to BLS CPI-U” and no alias hit
still has a Settles-to row.

### Step 2: Ranked suggestions

Rank: explicit series id in rules > resolution source map > ticker in
title (`extractArticleTickersFromParts`) > weak tokens.

Add aliases: FRED CPI/unemployment/fed funds, BTC/ETH Yahoo or existing
crypto series, TWC weather (already), VoteHub looser poll names, Adjacent
rates when the market is a rate.

**Verify**: keep weather/CPI/BTC tests; add BLS CPI-U without `CPIAUCSL`;
negative: election market must **not** map FRED GDP.

### Step 3: Reason column

`reason` already exists — set it to the rank source (`rules`, `ticker`,
`alias`) so the user can distrust weak rows.

## Test plan

This is a good test target (parser-like). Keep and extend
`settlement-match.test.ts`. No pane copy tests.

## Done criteria

- [ ] Negative election ≠ GDP
- [ ] CPI named in prose maps CPIAUCSL
- [ ] Existing weather/BTC tests pass
- [ ] `plans/README.md` row 054 → DONE

## STOP conditions

- CAT inventory is async and huge — suggest from a static allowlist of
  high-value series, do not fetch OWID on each market open.

## Maintenance notes

False positives are worse than empty suggestions. Precision first.
