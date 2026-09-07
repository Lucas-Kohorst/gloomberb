# Plan 074: Make pane tables flex instead of dropping columns

> **Executor instructions**: This is a batch. Independent slices run in parallel.
> Do not commit unless asked. Touch only the files in your slice. If a STOP
> condition hits, stop and report.
>
> **Drift check**: `git diff --stat b04fe16c..HEAD -- src/components/ui/table-layout.ts src/plugins/builtin/account-management src/plugins/builtin/byok src/plugins/builtin/plugin-market src/plugins/builtin/plugin-inspector src/plugins/builtin/ticker-detail/overview`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `b04fe16c`, 2026-09-04

## Why this matters

ACM AI (and copies) drop columns and recap leftover width as the pane resizes.
DataTable already grows `flexGrow` columns and can scroll horizontally.
Keep every column; flex the text column; scroll when the pane is narrower than
the min table.

Policy: **never drop columns on resize**. User `columnIds` settings still win.
Do not convert forms, charts, maps, chat, or help into tables.

## Shared pattern (every slice)

Replace width-threshold drops and leftover-width arithmetic with:

```ts
return [
  { id: "name", label: "NAME", width: 16, align: "left", flexGrow: 1 },
  { id: "status", label: "STATUS", width: 10, align: "left" },
];
```

- `width` is the **min content width**, not leftover pane width.
- Exactly one text/name column gets `flexGrow: 1`.
- Remove `showHorizontalScrollbar={false}` so overflow can scroll.
- Do not pre-assign leftover AND set `flexGrow` (DataTable grows the first flex column again).
- Tests that asserted `getTableWidth(cols) === paneWidth` or "hides columns as the pane narrows" must assert: all column ids present at every width, one `flexGrow`, min widths stable.
- AGENTS.md: no Esc/Enter footer hints (`isBindableHintKey` only binds single-char keys). Footer save/cancel chips for Enter/Esc are visual-only bugs.
- Comments: short, factual, only for non-obvious constraints. No narration.
- Tests: `bun test <touched files>`. Do not chase pre-existing failures elsewhere.

## Slice A — ACM AI

**Files**: `src/plugins/builtin/account-management/**`

1. AI tab is not a profile form. Do not wrap it in the form `ScrollBox`. Do not cap it at `formWidth = min(70, width-2)`. Give it remaining pane width/height (minus tabs + padding).
2. Delete `COLUMN_SETS` / `layoutAiColumns` / `minTableWidth`. Static columns: Provider (flexGrow 1), Status, Active, Action.
3. Drop the reserved 2-row `selectedRow.detail` strip (status is already a column).
4. Size the table as pane-root (`flexGrow`, no `height-2` nested inside a same-height ScrollBox).
5. Remove footer hints with `key: "Enter"` / `"Esc"`. Keep `m`/`k`/`s`/`r`/`d`. Keyboard `useShortcut` handlers stay.
6. `useAccountManagementFooter` must not register Ctrl+S on the AI tab.
7. Key form may stay a dedicated screen (do not block on stack-page conversion).

**Verify**: `bun test src/plugins/builtin/account-management`

## Slice B — COLUMN_SETS clones + leftover 070 hints

**Files**:
- `src/plugins/builtin/byok/columns.ts`
- `src/plugins/builtin/byok/columns.test.ts`
- `src/plugins/builtin/byok/pane.tsx`
- `src/plugins/builtin/byok/index.tsx`
- `src/plugins/builtin/plugin-market/columns.ts`
- `src/plugins/builtin/plugin-market/pane.tsx`
- `src/plugins/builtin/plugin-inspector/columns.ts`
- `src/plugins/builtin/plugin-inspector/pane.tsx`
- `src/plugins/builtin/ai/screener/footer.ts`

1. Same static-column treatment as ACM. `buildXColumns()` may drop the width argument.
2. Rewrite `byok/columns.test.ts`: full column id set at every width; name has `flexGrow`; do not require `byokTableWidth === paneWidth`.
3. Remove Enter/Esc footer hints in BYOK, plugin-market, AI screener. Keep real `useShortcut` handlers.
4. Add `shortcut: { prefix: "API" }` on `byokViewerTemplate`.

**Verify**: `bun test src/plugins/builtin/byok src/plugins/builtin/plugin-market src/plugins/builtin/plugin-inspector src/plugins/builtin/ai/screener`

## Slice C — PositionTable

**Files**: `src/plugins/builtin/ticker-detail/overview/components.tsx` and its tests if any.

Replace the hand-rolled Box/Text `PositionTable` with `DataTableView`. Keep all columns (Account flexGrow 1). No `minPaneWidth` drops. Header sort if cheap; skip search (few rows).

**Verify**: `bun test src/plugins/builtin/ticker-detail`

## Slice D — leftover-width flexGrow sweep

Every DataTable column builder that does `width - Σfixed` and sets **no** `flexGrow`. Do **not** touch Adjacent, futures, world-indices, prediction-markets, llm-stats, sectors, weather, connections pane, econ-statistics, market-valuation (slice E).

Known sites: screener, country-econ, dividend-yield, broker-manager, congress-trades, traffic, relative-valuation, treasury-auctions, bond-search, changelog, holders, ipo-calendar, market-halts, plugin-marketplace TUI columns, earnings-calls, polls, cds, thirteenf, credit-conditions, short-interest, research-search, earnings, econ calendar, historical-prices, analytics sector/risk, satellite, chart-composer data-catalog, connections/table.ts (unused twin — either wire it or leave it; do not delete unless unused is proven).

Set min width + `flexGrow: 1` on the leftover column. Stop taking `width` if unused.

**Verify**: `bun test` on each touched plugin folder.

## Slice E — stop width-threshold drops

Keep user `columnIds` where they exist. Remove `width >= N` filters.

Sites: `adjacent/indices.tsx` `createIndexColumns`, `adjacent/rates.tsx`, `prediction-markets/columns.ts`, `futures/table.tsx`, `world-indices/table.tsx`, `llm-stats/pane.tsx`, `sectors/sector-model.ts`, `weather/pane.tsx`, `weather/station-detail`, `econ-statistics/pane.tsx`, `market-valuation/pane.tsx`, `connections/pane.tsx` `columnsForWidth`, `world-venue-map/pane.tsx`.

Update tests that encode drops:
- `adjacent/normalize.test.ts` gutter-budget test
- `prediction-markets/plugin.test.tsx` "hides overflow prediction columns"
- `futures/table.test.ts` narrow vs wide column ids

Also convert Adjacent index constituents and rate sources from Box+Text maps to `DataTableView`, and Adjacent index news from ScrollBox map to `FeedDataTableStackView` (search + open article) if the article contract is already available; if news items lack reader ids, STOP that sub-part and keep the list conversion for constituents only.

**Verify**: `bun test src/plugins/builtin/adjacent src/plugins/prediction-markets src/plugins/builtin/futures src/plugins/builtin/world-indices`

## Slice F — marketplace galleries

Drive plugin-marketplace desktop-web from the same `DataTableStackView` as terminal (keep `EntryDetail` as stack detail). Same for layout-marketplace terminal/desktop if the list is a sortable catalog.

Keep install/toggle/source actions and search. Add `[s]`earch footer hint if search exists but is unhinted.

**Verify**: `bun test src/plugins/builtin/plugin-marketplace src/layout-marketplace`

## STOP conditions

- A slice needs to edit a file owned by another slice.
- Adjacent news cannot open the shared article reader without inventing ids.
- A change would disable kitty rendering or replace DataTable with a custom cell-character table on desktop.

## Commands

| Purpose | Command |
|---------|---------|
| Tests | `bun test <paths>` |
| Typecheck (optional, noisy) | `bun run typecheck:electrobun-view` |
