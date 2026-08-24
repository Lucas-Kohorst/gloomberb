# Plan 052: Handle empty Yahoo ESG payloads without a fake carbon block

> **Executor instructions**: Do not scrape Yahoo HTML as a first attempt.
> Prefer empty-state honesty. Register traffic via existing yahoo connection.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/builtin/esg`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

ESG “doesn’t work”. Plugin: `src/plugins/builtin/esg/`. Fetches Yahoo
`quoteSummary?modules=esgScores` **direct**, not Gloom Cloud. Hosted has
no ESG proxy.

`hasEsgData()` is true only if totalEsg / E/S/G / esgPerformance exist.
Yahoo often returns empty/`maxAge`-only (especially ETFs like IBIT) →
`No ESG data for {symbol}` empty state.

Carbon is **always** null (TODO in client + CHANGELOG) but the loaded view
still shows **CARBON & CLIMATE → Not available**, which looks broken even
when scores work.

## Current state

- `src/plugins/builtin/esg/client.ts` — Yahoo module + double
  `withConnectionRequest` (`yahoo` inside `YahooHttpClient`, plus `yahoo-esg`)
- `src/plugins/builtin/esg/pane.tsx` — empty vs loaded
- Tests: normalize only (`client.test.ts`), no live Yahoo

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/builtin/esg` | pass |

## Scope

**In scope**
- `src/plugins/builtin/esg/client.ts`
- `src/plugins/builtin/esg/pane.tsx`
- `src/plugins/builtin/esg/types.ts` if needed
- tests
- hosted proxy **only if** Yahoo ESG is blocked by CORS on hosted — then add
  a keyed data provider or reuse yahoo proxy, and `registerConnectionSource`
  is already yahoo

**Out of scope**
- A new ESG vendor
- Filling carbon with guessed EPA numbers
- Sustainalytics paid API

## Git workflow

- Branch: `fix/esg-empty-yahoo`
- Commit: `fix(esg): treat empty Yahoo scores as no data and hide carbon`

## Steps

### Step 1: Distinguish errors

- Network/CORS/non-200 → error empty state (existing)
- 200 with empty `esgScores` → “Yahoo has no ESG scores for {symbol}”
  (not a throw that looks like a plugin crash)
- Do not wrap `yahoo-esg` if `YahooHttpClient` already reports `yahoo`

**Verify**: client test with `{ esgScores: { maxAge: 1 } }` does not throw
unhandled; pane shows no-data, not a stack.

### Step 2: Hide carbon until populated

If every carbon field is null, do not render the Carbon & Climate section.
Remove or gate the TODO UI.

**Verify**: fixture with scores and null carbon — no `CARBON` heading in the
frame.

### Step 3: Hosted CORS

If hosted cannot call `query1.finance.yahoo.com` (check how other Yahoo
modules work — `src/plugins/builtin/yahoo`). Follow **that** proxy. Do not
invent `/api/proxy/esg`.

**Verify**: if yahoo already has a hosted path, ESG uses it. Test with
`isHostedWebClient` mock.

## Test plan

- Empty module → no-data
- Full scores → pane renders total
- Carbon section absent when null
- Pattern: `client.test.ts` normalize tests; add one pane render test only
  if empty-state copy is easy to assert

## Done criteria

- [ ] Empty `esgScores` is a no-data state, not a thrown “unavailable” with
      no explanation
- [ ] Carbon section omitted when unimplemented
- [ ] `bun test src/plugins/builtin/esg` passes
- [ ] `plans/README.md` row 052 → DONE

## STOP conditions

- Yahoo removed `esgScores` globally (all fixtures empty) — report; do not
  scrape HTML in this plan.
- Hosted yahoo proxy forbids this module — add allowlist, do not disable
  the pane.

## Maintenance notes

IBIT (ETF) often has no Sustainalytics scores. That is a data hole, not a
fetch bug. ETF flows (053) are a different dataset.
