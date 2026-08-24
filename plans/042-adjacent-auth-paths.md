# Plan 042: Use Adjacent auth routes for similar markets and news lists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9016c08e..HEAD -- src/plugins/builtin/adjacent src/renderers/cloudflare/data-providers/adjacent.ts src/renderers/cloudflare/data-providers/adjacent.test.ts src/plugins/prediction-markets/detail/adjacent-match.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

Hosted PM similar markets fails with:

`Adjacent request failed (400) for /api/data/adjacent/public/markets/polymarket:<id>/similar`

Adjacent **has no public similar endpoint**. Docs:
`GET https://api.adjacent.markets/api/v1/markets/{id}/similar` (Bearer required).
Public related news is `GET /api/v1/public/markets/{id}/news` (max 3, 24h+ old).
There is **no** `GET /api/v1/public/news` list — list/latest news is auth-only
(`GET /api/v1/news`, `GET /api/v1/news/latest`).

**Product decision (2026-08-24):** Adjacent is a paid integration. **Stop
using `/public/...` endpoints** on hosted and anywhere a worker/user key is
available. Auth routes give similar markets, full news lists, and live
(not 15-minute delayed) data. Hosted already injects `ADJACENT_API_KEY`;
the client must not flip to public just because the browser has no BYOK key.

The client still sets `isPublic = !apiKey` and builds `/public/markets` etc.
That hides the worker key and 400s similar + news list.

## Current state

- `src/plugins/builtin/adjacent/client.ts` — URL builder + path selection
- `src/plugins/builtin/connections/adjacent-cloud.ts` — hosted `/api/data/adjacent/{keyPath}`
- `src/renderers/cloudflare/data-providers/adjacent.ts` — worker proxies
  `https://api.adjacent.markets/api/v1/${keyPath}`
- `src/plugins/builtin/adjacent/prediction-integration.tsx` — similar UI reads
  `response.markets` with `id` / `title` / `yes_price`
- Adjacent similar JSON is `{ data: [{ market_id, question, latest_price, similarity }] }`
- Docs: https://docs.adjacent.markets/llms.txt
  - similar: `/api/v1/markets/{id}/similar` (auth)
  - market news public: `/api/v1/public/markets/{id}/news`
  - market news auth: `/api/v1/markets/{id}/news`
  - news list: `/api/v1/news?limit=&offset=` (auth)
  - search: query param is `search`, page size `per_page` (not `q` / not always `limit`)
  - prices interval enum: `1min|5min|1hour|1d` (not `1h`)

Excerpts:

```105:107:src/plugins/builtin/adjacent/client.ts
function isPublicMode(apiKey: string | null | undefined): boolean {
  return !apiKey;
}
```

```181:195:src/plugins/builtin/adjacent/client.ts
  private marketsPath(): string {
    return this.isPublic ? "/public/markets" : "/markets";
  }
  // indices/rates/news similarly flip to /public
```

```285:288:src/plugins/builtin/adjacent/client.ts
  async getSimilarMarkets(id: string): Promise<AdjacentSimilarResponse> {
    const url = buildUrl(`/markets/${id}/similar`);
```

```219:230:src/plugins/builtin/adjacent/client.ts
    const url = buildUrl(this.marketsPath(), {
      q: query,
      limit,
      platform,
    });
```

```387:402:src/plugins/builtin/adjacent/client.ts
  async getNews(...) {
    const url = buildUrl(this.newsPath(), { limit: params?.limit, cursor: params?.cursor });
```

Worker test **locks in the broken public similar URL**:
`src/renderers/cloudflare/data-providers/adjacent.test.ts:18-27`.

Hosted `adjacentFetchJson` **does not send** the browser Bearer
(`client.ts:114`) — worker secret is the only key. So hosted must use auth
prefixes.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `bun test src/plugins/builtin/adjacent src/renderers/cloudflare/data-providers/adjacent.test.ts src/plugins/prediction-markets/detail` | all pass |
| Typecheck (if you touch types) | `bun run typecheck:opentui` | exit 0 |

## Suggested executor toolkit

- Adjacent docs: https://docs.adjacent.markets/api/get-api-v1-markets-id-similar.md
- Adjacent news list: https://docs.adjacent.markets/api/get-api-v1-news.md
- Public market news: https://docs.adjacent.markets/api/get-api-v1-public-markets-id-news.md

## Scope

**In scope**
- `src/plugins/builtin/adjacent/client.ts`
- `src/plugins/builtin/adjacent/normalize.ts` (+ tests) for similar unwrap
- `src/plugins/builtin/adjacent/types.ts` if similar shape is wrong
- `src/plugins/builtin/adjacent/prediction-integration.tsx` if field names change
- `src/plugins/builtin/adjacent/news.ts` if latest/top paths change
- `src/renderers/cloudflare/data-providers/adjacent.ts` (optional reject of `public/**/similar`)
- matching `*.test.ts` files
- `src/plugins/prediction-markets/detail/adjacent-match.ts` only if id candidates still prefer Gamma numeric ids over `polymarket:0x…` / slug

**Out of scope**
- Kalshi CORS proxy / catalog rewrite (plan 043)
- PM news table UI (plan 048)
- Changing Adjacent rate limits or adding a user-facing API key requirement

## Git workflow

- Branch: `fix/adjacent-auth-paths` from current `main` / this worktree
- Commit style: `fix(adjacent): use auth similar and news routes on hosted`
- Do not push/PR unless asked

## Steps

### Step 1: Hosted uses auth prefixes

Add `usesWorkerAdjacentKey()` (or reuse `isHostedWebClient()`) so:

- Hosted **always** uses `/markets`, `/news`, `/indices`, `/rates`, `/events`
  (worker key). **No `/public` on hosted.**
- Desktop/TUI: if Adjacent is connected with a user key, same auth prefixes.
- `getMarketNews` must use auth `/markets/{id}/news` when a key exists so we
  get the full ranked list, not the public max-3 / 24h-old slice.
- Do not call `/public/markets/{id}/similar` anywhere (route does not exist).

**Verify**: unit-test `buildUrl` / client methods with a mock of
`isHostedWebClient`. There is currently **no** client path test — add
`src/plugins/builtin/adjacent/client.test.ts`.

Hosted similar URL must be `/api/data/adjacent/markets/{id}/similar`.
Hosted latest news must be `/api/data/adjacent/news/latest?...` not
`/public/news/latest`.

### Step 2: Fix query params against current docs

- `searchMarkets`: `search` + `per_page` + `page`. Drop `q`. On public-only
  desktop, also `scope=all`.
- `getNews`: `limit` + `offset` (auth list). Drop `cursor` unless you confirm
  it in docs.
- `getLatestNews`: check `/api/v1/news/latest` params; do not invent `cursor`.
- `getMarketPrices`: map `"1h"` → `"1hour"` if that helper is still called
  with `"1h"`.

**Verify**: tests assert query string contents.

### Step 3: Unwrap similar like news

`unwrapAdjacentNewsArticles` already accepts `{ data: [...] }`. Add
`unwrapAdjacentSimilarMarkets` mapping:

- `market_id` → `id`
- `question` → `title`
- `latest_price` → `yes_price` (Adjacent 0–100; UI that expects 0–1 must
  divide by 100 — check `prediction-integration.tsx` before converting)

**Verify**: `normalize.test.ts` covers `{ data: [...] }` similar payloads.

### Step 4: Stop locking in public similar in the worker test

Replace `adjacent.test.ts` fixture:

- A successful resolve of `markets/polymarket:0x` + 64 **hex** + `/similar`
- Optionally: `public/markets/.../similar` may still proxy (worker is dumb)
  but must **not** be the client's URL

Do not copy the `8dalce` (letter `l`) id; that is not hex.

**Verify**: `bun test src/renderers/cloudflare/data-providers/adjacent.test.ts`

### Step 5: Prefer canonical ids before similar/news

In `adjacent-match.ts`, try slug / `polymarket:{conditionId}` / `kalshi:{ticker}`
before Gamma numeric market ids. Do not call similar until `getMarket` succeeds
for a candidate.

**Verify**: existing `adjacent-match.test.ts` plus a case that Gamma numeric
is not the first attempted similar path.

## Test plan

- New `client.test.ts`: hosted vs desktop path selection for similar, news
  list, market news, search params.
- `normalize.test.ts`: similar `data` unwrap.
- `adjacent.test.ts`: hex market id allowed; no `8dalce` fixture.
- Keep `worker.test.ts` Adjacent proxy tests green.

Model tests after `src/plugins/builtin/adjacent/normalize.test.ts`.

## Done criteria

- [ ] `bun test src/plugins/builtin/adjacent src/renderers/cloudflare/data-providers/adjacent.test.ts` passes
- [ ] Hosted similar URL in tests is `/api/data/adjacent/markets/` not `/public/markets/`
- [ ] `grep -n "public/markets/.*/similar" src/plugins/builtin/adjacent` returns no client builders
- [ ] `grep -n "q: query" src/plugins/builtin/adjacent/client.ts` returns no matches
- [ ] No files outside scope (`git status`)
- [ ] `plans/README.md` row 042 → DONE

## STOP conditions

- Adjacent returns 403 (insufficient scope) on worker key — report; do not
  silently fall back to a fake public similar.
- `latest_price` scale (0–1 vs 0–100) is ambiguous in live payloads — inspect
  one live response before converting.
- `getLatestNews` docs disagree with `/news/latest` + `limit` — re-read
  changelog before guessing.

## Maintenance notes

Hosted Adjacent is only as good as `ADJACENT_API_KEY` on the worker. Connections
pane already folds this into Adjacent Cloud. Do not add a second source id.
