# Plan 043: Load hosted Kalshi catalogs from Adjacent, keep proxy for books

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. STOP rather than invent a third Kalshi origin.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/prediction-markets/services/kalshi src/plugins/prediction-markets/services/fetch.ts src/renderers/cloudflare/worker.ts src/plugins/builtin/adjacent/client.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/042-adjacent-auth-paths.md
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

Kalshi in PM “keeps failing” on hosted. There **is** a CORS proxy
(`/api/proxy/kalshi/...` → `https://external-api.kalshi.com/trade-api/v2`).
The catalog still pages up to 8×200 events through that proxy with a 10s
client timeout / 12s worker timeout. 429s are forwarded and not cached.
Adjacent fallback was **removed** on `improve/kalshi` (`894d474e`) because
routing the catalog through Adjacent first made the pane feel stuck.

The right split:

- **Catalog / search (hosted)**: Adjacent `GET /api/v1/markets?platform=kalshi`
  (worker key). One paginated list, not 8 Kalshi pages.
- **Order book / trades / candles / series settlement**: keep venue-native
  Kalshi via the CORS proxy.
- **Desktop/TUI**: may keep direct Kalshi catalog if it is reliable; hosted
  is the failure mode.

## Current state

```228:231:src/plugins/prediction-markets/services/kalshi/adapter.ts
    // Browse/search hits Kalshi directly. Adjacent is reserved for indices and
    // detail enrichments — routing the PM catalog through it added a multi-page
    // hop before the venue call, which is what made the pane feel stuck.
```

```44:61:src/plugins/prediction-markets/services/kalshi/adapter.ts
// hosted: `{origin}/api/proxy/kalshi/...`
```

- Connections already register `kalshi` in `prediction-markets/index.tsx`.
- Adjacent markets: `market_id` like `kalshi:KXNBA-26-SAS`, `probability` 0–100,
  `volume` contract counts. PM `yesPrice` is 0–1 (`kalshi/normalize.ts`).
- `registerConnectionSource` is required for any new HTTP path — reuse
  `adjacent` / `kalshi`, do not invent a third id.
- Keyed-data policy still says not to proxy Kalshi through `/api/data`
  (`src/renderers/cloudflare/data-providers/types.ts`). Leave that. Catalog
  goes through the existing Adjacent `/api/data/adjacent` provider.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/prediction-markets` | all pass |
| Worker | `bun test src/renderers/cloudflare/worker.test.ts` | all pass |

## Scope

**In scope**
- `src/plugins/prediction-markets/services/kalshi/adapter.ts`
- `src/plugins/prediction-markets/services/kalshi/normalize.ts` if mapping Adjacent rows
- new mapper module if that keeps adapter smaller
- `src/plugins/prediction-markets/plugin.test.tsx` hosted proxy assertions
- tests under `services/kalshi/`
- Adjacent `getMarkets({ platform: "kalshi", ... })` only if 042 left `limit`/`q` broken — then fix in 042, do not duplicate

**Out of scope**
- Polymarket Gamma (already CORS-ok in browser)
- New venues
- Deleting `/api/proxy/kalshi`
- Reintroducing the deleted `adjacent-fallback.ts` as a pre-catalog hop on desktop

## Git workflow

- Branch: `fix/hosted-kalshi-adjacent-catalog`
- Commit: `fix(pm): load hosted Kalshi catalogs from Adjacent`

## Steps

### Step 1: Map Adjacent market rows → `PredictionMarketSummary`

Write a pure mapper (new file next to `kalshi/normalize.ts`):

- `market_id` `kalshi:TICKER` → venue `kalshi`, `marketId` = ticker
- `probability` / 100 → `yesPrice`
- `volume_24h`, `open_interest`, `end_date`, `question`, `status`
- Group by Adjacent event if the list includes parent event ids; if the public
  list is flat markets, keep them as single rows (no fake group)

**Verify**: unit tests with a fixture copied from Adjacent docs (Kalshi NBA
example in market-data.md). Probability 65 → 0.65.

### Step 2: Hosted browse/search uses Adjacent

In `kalshi/adapter.ts` catalog load:

- If `isHostedWebClient()`: `getSharedAdjacentClient().getMarkets` /
  `searchMarketsByText` with `platform: "kalshi"`, `scope=all` if still on
  public (should not be after 042).
- Else: existing Kalshi event pages.

Search: Adjacent `search` is case-insensitive word match (docs). Do not page
4×200 Kalshi events on hosted.

**Verify**: `plugin.test.tsx` currently expects hosted Kalshi to use the
proxy. **Update** browse tests: hosted catalog fetch is `/api/data/adjacent/...`
or `api.adjacent.markets`. Hosted **book** fetch still uses `/api/proxy/kalshi`.

### Step 3: Keep proxy for live book

Do not change `fetchKalshiOrderbook` / trades / candlesticks origins.

**Verify**: `grep -n "api/proxy/kalshi" src/plugins/prediction-markets/services/kalshi` still hits book/trades. Catalog path does not.

### Step 4: Footer / errors

If Adjacent catalog fails, keep Polymarket rows visible (existing pane test
“keeps fallback venue markets visible”). Surface Kalshi as catalog error in
the footer (`catalogStatus`), not a full-pane spinner.

## Test plan

- Mapper: probability scale, ticker strip `kalshi:` prefix, missing volume
  → null not `NaN`.
- Adapter: hosted browse does not call `external-api.kalshi.com` or
  `/api/proxy/kalshi/events`.
- Adapter: hosted book still uses proxy.
- Desktop path unchanged (direct Kalshi events).
- Pattern: `src/plugins/prediction-markets/plugin.test.tsx` hosted proxy test.

## Done criteria

- [ ] `bun test src/plugins/prediction-markets` passes
- [ ] Hosted catalog tests assert Adjacent, not 8 event pages
- [ ] `/api/proxy/kalshi` still used for books
- [ ] `plans/README.md` row 043 → DONE

## STOP conditions

- Adjacent kalshi list is constituents-only and you cannot pass `scope=all`
  on the auth route — read docs; do not silently show 50 index names as the
  whole venue.
- Adjacent lacks event grouping so the PM dropdown tree disappears — report
  before flattening production UX.
- Worker `ADJACENT_API_KEY` missing in a test env — tests must mock the client,
  not call live Adjacent.

## Maintenance notes

Desktop can stay on venue-native catalogs (fresher books). Hosted uses Adjacent
because CORS + 429 + timeout made Kalshi-direct catalogs fail. If Kalshi later
ships CORS, do not delete Adjacent hosted catalog until measured.
