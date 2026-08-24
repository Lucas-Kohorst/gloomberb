# Plan 046: Densify PM table, keyboard, event ticker, catalog footer

> **Executor instructions**: Follow this plan. Do not put row counts or
> “Prediction Markets” in the footer. Do not disable kitty.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/prediction-markets src/plugins/builtin/adjacent/indices.tsx src/components/data-table src/components/ui/table-layout.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

In a narrow pane the user cannot see columns past SPR. Default columns are
fixed-width: ★2 + MARKET 34 + TICKER 20 + VENUE 9 + TOP ODDS 20 + SPR 7 ≈ 92
cells before VOL24H. OpenTUI `expandTableColumns` grows but does not shrink.
DataTableView has no left/right key pan; `h`/`l` are category tabs.

Event group rows show an event ticker; they should show `-` (children keep
the contract ticker).

Catalog poll (Kalshi 20s / Polymarket 30s) never sets `lastRefreshAt` —
footer poll/updated only appears in **detail**. User wants browse
`poll ~1m` / `updated ~1m`.

Watchlist Enter expand already has a test. Residual: switching browse tab
clears `selectedRow`, so `[w]` is disabled until a move. Auto-select first
visible row (news table pattern).

**Keyboard to Top / Ending / New / Watchlist (2026-08-24 screenshot):**
`resolvePredictionKeyboardCommand` maps `1`–`4` to those browse tabs, but
`usePredictionControllerKeyboard` does **not** `preventDefault` /
`stopPropagation` on them, and the browse `Tabs` in `pane.tsx` are
**unfocused** (`Tabs` only handles arrows when `focused={true}`). Venue
tabs use Shift+h/l; categories use h/l; browse is unreachable from the
keyboard in practice (especially web). Fix:

1. `preventDefault` + `stopPropagation` on `browse-top|ending|new|watchlist`.
2. Cycle browse with the existing footer `[1-4]` **and** `[` / `]` (or
   make browse `Tabs` `focused` when that chrome row is active).
3. Bind the footer hint. Add a test that `1` selects Top, `4` Watchlist,
   and `[`/`]` cycle.
4. Add mouse/cursor interactivity already present; do not remove it.

Do not steal `h`/`l` from categories.

## Current state

```126:137:src/plugins/prediction-markets/columns.ts
export const DEFAULT_PREDICTION_COLUMN_IDS = [
  "watch", "market", "market_id", "venue", "yes", "spread",
  "vol_24h", "open_interest", "ends", "status",
];
```

Density exemplar: `createIndexColumns(width)` in
`src/plugins/builtin/adjacent/indices.tsx:57-80` (drop columns by width,
`flexGrow` on name).

```107:114:src/plugins/prediction-markets/pane.tsx
  const updatedAgo = useUpdatedAgo(controller.lastRefreshAt);
  const pollLabel = useMemo(() => {
    if (!controller.detailOpen) return null;
    ...
```

`lastRefreshAt` set in `controller/detail.ts` only.
`transportState` is computed and never rendered.

Group ticker: `getPredictionColumnValue` `market_id` uses
`formatPredictionTicker(row)` for groups too (`metrics.ts`).

Footer helpers to reuse: `useUpdatedAgo`, `useFeedPollInterval` /
`formatPollIntervalFooterLabel`, `usePaneStatusLinkFooter`.
Hints: `[/]` search, `[r]` refresh, `[o]` when URL, `[g]` graph.
No fixed labels, no row counts.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/prediction-markets` | pass |

## Scope

**In scope**
- `src/plugins/prediction-markets/columns.ts`
- `src/plugins/prediction-markets/metrics.ts` (group ticker)
- `src/plugins/prediction-markets/pane.tsx` (columns from width + footer)
- `src/plugins/prediction-markets/controller/catalog.ts` (`catalogLastRefreshAt`)
- `src/plugins/prediction-markets/controller/effects.ts` or `data.ts` (select first)
- `src/plugins/prediction-markets/keyboard.ts` / `controller/keyboard.ts` only if
  adding overflow pan keys
- tests: `plugin.test.tsx`, `pane.test.tsx`, `detail` ticker if needed

**Out of scope**
- Extra venues
- Watchlist → PF collection (plan 053)
- Instant search (plan 047)
- Horizontal scroll as the *only* density fix
- Shared DataTable pan unless PM cannot bind Shift+h/l without it — prefer
  PM-local first

## Git workflow

- Branch: `fix/pm-pane-density`
- Commits: `fix(pm): hide overflow columns by width`, `fix(pm): event rows show dash ticker`, `fix(pm): catalog poll in footer`

## Steps

### Step 1: Width-adaptive columns

Add `createPredictionColumns(width: number)`:

- Always: `watch`, `market` (`flexGrow: 1`, shrink min ~18–24), `yes`, `spread`
- Hide `market_id` (TICKER) below ~100
- Hide `venue` / `status` / `ends` as width drops (mirror indices.tsx breakpoints)
- `vol_24h` / `open_interest` next to drop

Pass pane width from the stack view into column builder (how indices/news do it).

**Verify**: unit test of column ids at widths 64, 80, 100, 132.

### Step 2: Event TICKER is `-`

In `getPredictionColumnValue` for `market_id`, if `row.kind === "group"`
return `"-"`. Children unchanged.

**Verify**: existing group fixture in `plugin.test.tsx`: parent `-`, child
keeps `KXFED-…`.

### Step 3: Catalog footer freshness

Set `catalogLastRefreshAt` on successful catalog load.
Browse footer:

- `updated ${useUpdatedAgo(catalogLastRefreshAt)}` when data exists
- `poll 20s` / `poll 30s` via `formatPollIntervalFooterLabel` (or unify
  browse interval to 60s if you add `useFeedPollInterval` — product note said
  `~1m`; **prefer showing the real interval** rather than lying)

Detail: keep `live` (Polymarket WS) / `poll 5s` (Kalshi).

Use `transportState` for loading/error/stale. No row counts.

**Verify**: pane test: after catalog mock load, footer frame contains `updated`
without opening detail.

### Step 4: Auto-select first row

When `visibleRows` becomes non-empty and `selectedRowKey` is null, select
`visibleRows[0].key` (see `news/wire/news/table.tsx:208-216`).

Keep the watchlist Enter expand test green.

**Verify**: `pane.test.tsx` watchlist Enter still expands; add that `[w]` is
enabled after tab switch without an extra `j`.

## Test plan

- Column ids vs width (parser-like, keep).
- Group ticker `-`.
- Footer updated without detail.
- Do not snapshot all footer hint copy.

## Done criteria

- [ ] Narrow width 80 does not include TICKER+VENUE+ENDS+STATUS together with MARKET 34
- [ ] Group TICKER is `-`
- [ ] Browse footer shows `updated` after catalog load
- [ ] `bun test src/plugins/prediction-markets` passes
- [ ] `plans/README.md` row 046 → DONE

## STOP conditions

- Column builder already exists on HEAD — extend it, do not add a second.
- Footer already shows catalog poll (branch
  `fix/prediction-markets-footer-freshness`) — rebase, do not duplicate.

## Maintenance notes

Web CSS grid can shrink (`table-layout.ts` minmax); TUI cannot. Density is
the TUI fix. Keep horizontal scrollbar as a backstop, not the product answer.
