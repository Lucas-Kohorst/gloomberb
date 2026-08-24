# Plan 053: Treat watchlists as PORT collections; spike ETF flows

> **Executor instructions**: Do not reuse Holders, 13F, or scanner FLOW as
> ETF create/redeem. Spike the flow vendor before writing a pane.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/builtin/analytics src/plugins/builtin/portfolio-list src/plugins/builtin/kelly-sizer src/types/config.ts src/types/ticker.ts`

## Status

- **Priority**: P2
- **Effort**: L (watchlists M, ETF flows L and may STOP)
- **Depends on**: none
- **Risk**: MED
- **Category**: direction
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

PF already lists watchlists (`new-collection-pane`,
`collectionScope: "all"`). Analytics / PORT / RISK / Kelly only read
`config.portfolios` and `ticker.metadata.portfolios` + positions.
Watchlists have no shares/cost.

User also wants IBIT-style ETF inflows/outflows. **No flow series exists
in this repo.** Yahoo heatmap has `fund.netassets` snapshot, not daily
flow. Scanner FLOW is options unusual activity.

PM starring is a **separate** plugin-local `watchlist:v1` and never creates
`KALSHI:`/`POLY:` tickers in PF — that belongs with PM (046 leftover / this
plan’s PM bullet).

## Current state

```61:115:src/plugins/builtin/analytics/index.tsx
// resolvePortfolioId(portfolios only)
// filter tickers by metadata.portfolios + hasPortfolioPosition
```

`canCreate` requires `config.portfolios.length > 0`.
Empty: `"No portfolios found"`.

PM star: `prediction-markets/controller` `watchlist:v1`.
Kelly already understands `KALSHI:` / `POLY:` (`kelly-sizer/asset.ts:29-31`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/builtin/analytics src/plugins/builtin/portfolio-list src/plugins/builtin/kelly-sizer` | pass |

## Scope

**In scope**
- analytics portfolio resolution to accept a watchlist id
- equal-weight (or cap-weight) convention when no positions
- empty states / `canCreate`
- PM star → upsert `KALSHI:{ticker}` / `POLY:{slug}` into default watchlist
  **or** a dedicated `prediction-markets` collection (mirror Adjacent
  `ADJACENT_WATCHLIST_ID`)
- ETF flow: research note + **only** implement if a free/allowable source
  is identified (Yahoo AUM time series is a weak proxy — label it as AUM
  change, not official flow)

**Out of scope**
- Broker positions on watchlists
- CoinGecko revival
- Scanner FLOW rename

## Git workflow

- Branch: `feat/watchlist-in-analytics` and optionally `feat/etf-flows`
- Commits split: analytics membership vs ETF source

## Steps

### Step 1: Collection identity

Introduce a small helper `resolveAnalyticsCollection(config, id)` that
returns `{ kind: "portfolio" | "watchlist", id, name }`. Portfolio tabs
in analytics include watchlists after portfolios.

**Verify**: unit test on the helper.

### Step 2: Weights

- Portfolio: existing positions
- Watchlist: equal weight 1/n unless a ticker has market cap in the quote
  cache — if cap-weight is more than a few lines, **equal weight v1**

Risk/VaR on a watchlist must say it is **indicative** (no lots). Do not
invent cost basis.

**Verify**: analytics test with a watchlist of 2 tickers, no positions,
overview renders 50/50.

### Step 3: PM stars land in PF

On PM `toggleWatchlist`, also add/remove a ticker in
`config.watchlists` default `watchlist` (or `prediction-markets` collection
seeded like Adjacent). Hosted: `writeHostedUserConfig`, do not put keys in
snapshots.

**Verify**: star test writes ticker membership; unstar removes.

### Step 4: ETF flows spike (STOP-friendly)

Search whether Yahoo chart/module already has AUM history we ignore. If
yes, a pane “AUM (proxy)” for `IBIT` is acceptable if labeled proxy.

If not, list candidate vendors (Farside, SoSoValue, CoinGlass) and **STOP**
without scraping a ToS-hostile page.

Do not register a connection until a real fetch path exists.

## Test plan

- Collection resolver
- Watchlist overview without positions
- PM star membership
- ETF: only if implemented

## Done criteria

- [ ] Analytics can select the default watchlist
- [ ] PM star appears in PF watchlist
- [ ] ETF either shipped as labeled AUM proxy **or** this plan’s ETF section
      marked BLOCKED with the vendor reason
- [ ] `plans/README.md` row 053 updated

## STOP conditions

- Risk math with equal-weight watchlists is misleading enough that product
  wants watchlists **out** of VaR — then only Overview sector allocation,
  not RISK.
- ETF vendor requires a paid key / ToS forbid — BLOCKED, do not scrape.

## Maintenance notes

Command bar still has separate `AP`/`AW`. Leave them; PF is the mixed
surface.
