# Plan 055: Clean command-bar ticker results and Portfolio Analytics chrome

> **Executor instructions**: Use shared Tabs / SegmentedControl. Do not
> repeat the pane title in the body. Load design skills before editing UI.
> Desktop/web: real DOM, not cell-character chrome.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/components/command-bar src/plugins/builtin/analytics`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/049-search-and-command-bar.md (ticker-first behavior)
- **Category**: direction
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

Screenshot 1: command bar `aapl |` with **Ask AI** heading then
`DES AAPL — Open security details for AAPL` / QQ / G. Density, grouping,
and labels are wrong even after 049 wires ticker search.

Screenshot 2: Portfolio Analytics pane title plus a row that reads as
three peer tabs: **Main Portfolio | Overview | Risk**. Those are a
collection `Tabs` plus a view `SegmentedControl` on one row. Overview
still has a “Risk / Return” block while a Risk view exists. Sector
heading repeats the SECTOR column.

AGENTS.md: never repeat the same information in title and body.

## Current state

Command bar list: `src/components/command-bar/list/view.tsx` renders
label + trailing. Assist builds `input — title` (`assist/model.ts:76-95`).
Category headings + spacers (`list/model.ts:65-78`). Ask AI priority -100.

Analytics: `src/plugins/builtin/analytics/index.tsx` pane title
“Portfolio Analytics”, `Tabs` of portfolio names, unfocused
`SegmentedControl` Overview/Risk (`[v]` toggles). Risk view in
`risk-view.tsx` stacks section titles: Value at Risk, Factor Exposure, …

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/components/command-bar src/plugins/builtin/analytics` | pass |

## Suggested executor toolkit

- `frontend-design`, `impeccable`, `better-layout`, `better-writing`,
  `baseline-ui` (if present)
- TUI: OpenTUI skill. Web: do not draw GUI with cell characters.

## Scope

**In scope**
- command-bar result grouping/labels for a ticker query
- analytics header: one collection picker + view switch that does not look
  like a third tab
- drop duplicate inner headings that restates the view name
- tests for grouping/order, not pixel screenshots

**Out of scope**
- New analytics metrics
- Watchlist-in-analytics (053)
- Theme (051)

## Git workflow

- Branch: `fix/cmdbar-analytics-chrome`
- Commits: `fix(command-bar): group ticker actions under the security`,
  `fix(analytics): separate collection picker from view switch`

## Steps

### Step 1: Command bar ticker block

For a resolved security, **one** primary row:

```
AAPL    Apple Inc.                 NASDAQ
```

Child or trailing actions: Details · Quote · Chart (shortcuts DES/QQ/G as
trailing chips, not in the title). Ask AI **below** a rule, collapsed
unless the query is a sentence.

Section tax: do not emit a heading for a single Ask AI row if a ticker
matched.

**Verify**: test items for query `aapl`: first item is the security, not
Ask AI; no `DES AAPL —` label.

### Step 2: Analytics chrome

- Keep pane title “Portfolio Analytics”
- Collection: `Tabs` **or** a compact select of book names — not visually
  identical to Overview/Risk
- View: footer `[v]` plus a **secondary** control (segmented, smaller, not
  on the same tab row). Recommended: move Overview/Risk to the pane header
  **right** or to the first body row as text links, not a third tab
- Overview: start with metrics; drop “Risk / Return” and “Sector
  Allocation” headings if the columns already name them
- Risk: keep one title per table only if the table has no header that
  already names it

**Verify**: frame/test: the words “Main Portfolio”, “Overview”, and “Risk”
are not three adjacent tab labels of the same component. Prefer asserting
component structure (Tabs options vs SegmentedControl options) over copy.

## Test plan

- Command bar item order/labels (049 tests may already cover order; this
  adds grouping).
- Analytics: Tabs values are portfolio names only.
- Skip static metadata tests.

## Done criteria

- [ ] `aapl` command-bar first row is the security, actions are not
      prefixed `DES AAPL —`
- [ ] Analytics collection tabs do not include Overview/Risk
- [ ] Duplicate “Sector Allocation” heading removed when column is SECTOR
- [ ] Tests pass
- [ ] `plans/README.md` row 055 → DONE

## STOP conditions

- `[v]` is load-bearing for TUI keyboard (comment in analytics `index.tsx`
  83–85) — keep `[v]` even if the segment moves.
- Command bar child rows are not supported by the list model — then one
  security row whose Enter opens DES, with QQ/G as `[`/`]` or trailing
  hints, and report.

## Maintenance notes

049 is behavior; 055 is hierarchy. If 049 already cleaned labels, this
plan only groups rows.
