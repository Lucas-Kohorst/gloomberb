# 039 — Web renderer sweep: remaining findings

Four read-only audits of the Electrobun/web renderer and the share page, each
applying a different rubric (accessibility, motion performance, React
performance, and the repo's own documented UI rules in `AGENTS.md` /
`PLUGINS.md`).

Everything cheap and provable was already shipped:

| Shipped | PR |
|---|---|
| `prefers-reduced-motion`, plus `filter: brightness` off streaming rows | #191 |
| Share page keyboard sort, AA contrast, loading announcements | #192 |
| Tab close via Delete, dialog focus trap | #193 |
| Dead `.br`/`.gz` pre-compression removed | #190 |

What follows is what was **not** shipped, and why. Each item is scoped so it can
be picked up independently.

---

## P1 — Streaming quotes invalidate every visible table row

**Anchors:** `src/components/ticker/list-table-view.tsx:181-202`,
`src/renderers/electrobun/view/data-table/index.tsx:364-393`

Each quote update builds a new `financialsMap`, which recreates `renderCell`.
`WebDataTableRow` *is* wrapped in `memo`, but `renderCell` changes identity every
tick, so the memo never holds: every virtualized row re-renders and every
sparkline element is recreated when one symbol moves.

Cost scales with `visible rows x columns x open panes`, continuously during
market hours. This is the single largest performance item found.

**Fix:** pass row-scoped financials (or a per-row revision counter) into the row
and give `memo` a comparator that ignores table-level `renderCell` identity when
that row's own data is unchanged.

**Why it was not shipped:** it changes the hot path of every data table in the
app. It needs a before/after measurement to prove the win and to prove no rows
go stale, and the fix has to be checked against the virtualizer's recycling
behaviour. Worth doing properly rather than by inspection.

---

## P2 — Market heatmap relayouts entirely on every quote batch

**Anchor:** `src/plugins/builtin/market-heatmap/index.tsx:87-105`

`useLiveQuoteEntries` returns a new entries map whenever any subscribed quote
changes, which rebuilds all `resolvedAssets`, all `items`, and
`buildMetricTreemapNavigationTiles()` for up to 96 assets. One symbol ticking
triggers a full treemap layout.

**Fix:** separate geometry from tint. Keep asset/item identity stable and
memoize the layout on the inputs that actually affect geometry, so a quote change
only repaints the affected tile.

---

## P2 — Store subscribers are notified twice per dispatch

**Anchors:** `src/state/app/context/index.tsx:395-399` and `:520-525`

`dispatch()` notifies every listener synchronously, then a
`useLayoutEffect([state])` notifies all of them again after the provider
re-renders. Every selector callback and `useSyncExternalStore` bookkeeping runs
twice per action.

**Fix:** notify from one place. Keep the synchronous `stateRef` update so
callbacks read fresh state, and drop the second pass (or gate it on reducer
output identity actually changing).

**Care required:** the synchronous notification exists so callbacks do not read
stale state. Removing the wrong one reintroduces that. Needs a test that pins
"listener sees post-dispatch state" before touching it.

---

## P2 — Nine data tables have no clickable header sort

`AGENTS.md` requires: *"Data tables need clickable header sort (asc/desc), the
same as Adjacent Indices."* These pass `sortColumnId={null}` with a no-op
`onHeaderClick`, so the headers are inert:

- `plugins/builtin/alerts/pane.tsx:295-297`
- `plugins/builtin/scanner/flow-pane.tsx:192-194`
- `plugins/builtin/scanner/hilo-pane.tsx:156-158`
- `plugins/builtin/earnings/index.tsx:175-177`
- `plugins/builtin/broker-manager/index.tsx:291-293`
- `plugins/builtin/research/relative-valuation-pane.tsx:176-178`
- `plugins/builtin/ticker-detail/data-panes/provider-search.tsx:135-137`
- `plugins/builtin/ticker-detail/data-panes/historical-prices.tsx:185-187`
- `plugins/builtin/ticker-detail/financials/tab.tsx:387-389`

Reference implementations: `adjacent/indices.tsx:517+` and
`market-movers/index.tsx:306+`. #187 also adds a reusable
`nextTableSort`/`applyTableSort` pair (nulls last in both directions) that these
should adopt rather than each rolling its own comparator.

**Suggestion:** land after #187 so there is one shared helper, and do it as one
PR per pane group rather than a single sweeping change.

---

## P2 — Footer and title rule violations

`AGENTS.md`: footers carry *"status that can change ... plus action hints. No
fixed labels, row counts, or generic keyboard hints"*, and *"never repeat the
same information in a pane title/header and again in the body"*.

- `plugins/builtin/alerts/pane.tsx:157-171` — footer shows `active` and
  `triggered` counts
- `plugins/builtin/news/wire/rss-pane.tsx:358-361` — pane title is already
  "RSS Feeds"; body repeats `RSS Feeds ({rows.length})`
- `plugins/builtin/broker-manager/index.tsx:254-259` — pane title is "Brokers";
  body repeats "Brokers"
- `plugins/builtin/ai/workspace/pane.tsx:151` — inline keyboard hint strip in the
  body instead of the shared pane footer

No footer hint with a missing key handler was found, which is the failure mode
`AGENTS.md` calls out explicitly as a bug. That rule is being followed.

---

## P3 — Theme token drift

Most chrome is tokenized, and `theme/colors.ts:32-52` keeps variables
synchronized, but these bypass it and will not follow a theme change:

- `plugins/builtin/account-management/pane.tsx:264` — hardcoded
  `rgba(255,255,255,0.025)` shadow
- `plugins/builtin/correlation/relationship/view-model.ts:37,68` and
  `pane.tsx:309` — hardcoded chart colours instead of
  `getChartIndicatorColor()`
- `renderers/electrobun/view/styles.css:142` — hardcoded `#c42b1c`/`#ffffff` on
  the window close control

---

## P3 — Inline transitions cannot honour reduced motion

#191 guards the two CSS-driven animations, but tab hover
(`host/tabs.tsx:136,276`) and treemap hover
(`components/metric-treemap/index.tsx:157`) declare `transition` as **inline
styles**, which a media query cannot override. Reaching them needs a
`usePrefersReducedMotion()` hook threaded through both components.

Both are 110-120ms colour-only transitions on hover, so this is low urgency, but
it is the remaining gap in reduced-motion coverage.

Also noted: `metric-treemap/index.tsx:157` transitions `filter: brightness` on
hover. Same paint-property issue as the row animation fixed in #191, but scoped
to one small tile on hover rather than streaming data.

---

## P3 — Semantic metadata rebuilds up to 200 rows on unrelated re-renders

**Anchor:** `src/components/ui/data-table/index.tsx:15-67`

Remote registration maps `props.items.slice(0, 200)` into metadata whenever
inputs change, so a parent re-render triggered by unrelated quote-derived UI
repeats the allocation. Memoize on item identity and selection instead.

---

## Motion opportunities (optional, taste-driven)

The audit's verdict was that this app's motion discipline is already better than
most: no animation on the command bar, tab switches, charts, sparklines, or
gauges; no `transition: all`; no `will-change` misuse; virtualized rows
positioned with `transform`. Almost everything is correctly left alone.

Only one has clear leverage:

- **Toast enter/exit** (`renderers/electrobun/view/toast-host.tsx:25-35`) —
  toasts appear and vanish instantly, and the stack snaps upward when one
  expires. A 200ms opacity + `translateY(8px)` transition on enter and exit would
  fix a genuine jolt, at a frequency tier that justifies it.

Second, weaker:

- **Dialog backdrop fade** — the 64% dim overlay appears instantly. A 150ms fade
  via `@starting-style` would remove the flash.

Explicitly rejected, with reasons, so they are not revisited: command bar
open/close (keyboard-initiated, 100+/day, never animate), sparkline path drawing
(constant motion on data being read), speedometer needle spring (implies
continuity the discrete data does not have), data-table row hover (would feel
sluggish during fast traversal), tab underline (delays confirmation of the active
tab), onboarding entrance (adds perceived delay to a task the user wants to
finish).

---

## Not applicable

`vercel-optimize` assumes a Vercel-deployed framework project; this is a
Bun-bundled SPA on Cloudflare Workers, so its metrics workflow does not apply.
The composition rubric found nothing material: providers expose state and actions
cleanly and there is no boolean-prop proliferation in the audited paths.

## Verified already correct

Worth recording so future audits do not re-litigate: desktop data tables are
virtualized by default (`data-table/index.tsx:112-126`, `@tanstack/react-virtual`);
quote subscriptions dedupe targets, merge priorities, batch and throttle
(`market-data/coordinator/quotes.ts:310-337`); market subscriptions are
key-scoped (`coordinator/events.ts:48-72`); effect cleanup is consistently
correct across quote subscriptions, polling, resize observers and chart
listeners; heavy hosted dependencies are already code-split
(`build-assets.ts:64-76`); `normalizeTheme()` (`theme/themes.ts:38-115`) enforces
contrast minimums for the terminal app; dialogs and popovers already handle
`role`, `aria-label`, Escape and focus restoration; the share page sanitizes
URLs, preserves alt text, avoids `dangerouslySetInnerHTML`, and sets
`rel="noreferrer noopener"` on external links.
