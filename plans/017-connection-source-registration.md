# Plan 017: Register missing connection sources for fear-greed, market-movers, and thirteenf

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/plugins/builtin/fear-greed/index.tsx src/plugins/builtin/market-movers/index.tsx src/plugins/builtin/thirteenf/index.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

The AGENTS.md coding guidelines state: "Every external API or data source is a Connection. Register it with `registerConnectionSource()`." Three plugins fetch from external APIs but skip registration: fear-greed (CNN), market-movers (Yahoo Finance screener), and thirteenf (forms13f.com). The Connections pane is supposed to be the inventory of every live integration, but these three are invisible there.

## Current state

The connection registration pattern is established in 10+ plugins. The API:

```typescript
// src/plugins/builtin/connections/register.ts:16-24
export function registerConnectionSource(source: ConnectionSourceDef): () => void
```

`ConnectionSourceDef` fields: `id`, `name`, `kind` ("http" | "ws"), `pluginId`, `priority?`, `isWebSocket?`, `authRequired?`.

Example from an existing plugin that does it right — check how `congress-trades` or `polls` registers in its `setup()` function:

```typescript
// Pattern: call registerConnectionSource in plugin setup(), return cleanup
setup(ctx) {
  const unregister = registerConnectionSource({
    id: "cnn-fear-greed",
    name: "CNN Fear & Greed",
    kind: "http",
    pluginId: "fear-greed",
    authRequired: false,
  });
  return () => { unregister(); };
}
```

The three plugins that need this:

1. **`src/plugins/builtin/fear-greed/index.tsx`** — fetches from `production.dataviz.cnn.io` (see `data.ts:4`). No `registerConnectionSource` call in setup.
2. **`src/plugins/builtin/market-movers/index.tsx`** — uses `createThrottledFetch` to Yahoo Finance screener API. No registration.
3. **`src/plugins/builtin/thirteenf/index.tsx`** — fetches from `https://forms13f.com/api/v1` (see `api.ts:28`). No registration.

Also wrap the actual fetch paths in `withConnectionRequest()` / `reportConnectionRequest()` so traffic shows up in Connections. Check how other plugins do this — grep for `withConnectionRequest` to find an exemplar.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck`              | exit 0, no errors   |
| Tests     | `bun test`                       | all pass            |

## Scope

**In scope**:
- `src/plugins/builtin/fear-greed/index.tsx`
- `src/plugins/builtin/fear-greed/data.ts` (wrap fetch in connection reporting)
- `src/plugins/builtin/market-movers/index.tsx`
- `src/plugins/builtin/market-movers/screener.ts` (wrap fetch in connection reporting)
- `src/plugins/builtin/thirteenf/index.tsx`
- `src/plugins/builtin/thirteenf/api.ts` (wrap fetch in connection reporting)

**Out of scope**:
- Any other plugin — only these three are missing registration.
- Changing the fetch logic itself, only adding reporting wrappers.

## Steps

### Step 1: Register fear-greed connection source

Add `registerConnectionSource` call in the fear-greed plugin's `setup()` function (or add a `setup()` if it doesn't have one). Source: `id: "cnn-fear-greed"`, `name: "CNN Fear & Greed"`, `kind: "http"`, `pluginId: "fear-greed"`, `authRequired: false`.

Wrap the fetch in `fetchFearGreedData` (`data.ts`) with `withConnectionRequest("cnn-fear-greed", () => fetcher(url, ...))` or `reportConnectionRequest` after the fetch completes.

**Verify**: `bun run typecheck` → exit 0

### Step 2: Register market-movers connection source

Add registration in market-movers plugin setup. Source: `id: "yahoo-screener"`, `name: "Yahoo Finance Screener"`, `kind: "http"`, `pluginId: "market-movers"`, `authRequired: false`.

Wrap the throttled fetch in `screener.ts` with connection reporting.

**Verify**: `bun run typecheck` → exit 0

### Step 3: Register thirteenf connection source

Add registration in thirteenf plugin setup. Source: `id: "forms13f"`, `name: "Forms13F"`, `kind: "http"`, `pluginId: "thirteenf"`, `authRequired: false`.

Wrap the `httpFetch` call in `api.ts` with connection reporting.

**Verify**: `bun run typecheck` → exit 0

### Step 4: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `grep -rn "registerConnectionSource" src/plugins/builtin/fear-greed/` returns matches
- [ ] `grep -rn "registerConnectionSource" src/plugins/builtin/market-movers/` returns matches
- [ ] `grep -rn "registerConnectionSource" src/plugins/builtin/thirteenf/` returns matches
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The plugin files don't have a `setup()` function and the pattern for adding one is unclear — check how other plugins without setup handle registration.
- `withConnectionRequest` or `reportConnectionRequest` doesn't exist — grep for the actual function names in `connections/register.ts`.

## Maintenance notes

- Any new plugin that fetches from an external API must also register a connection source. Reviewers should check for this in PRs adding new plugins.
