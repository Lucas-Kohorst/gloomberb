# Plan 076: Disable unsupported chart intervals and ranges in the composer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, skip updating `plans/README.md`
> (the reviewer maintains the index).
>
> **Drift check (run first)**: `git diff --stat 43b8e69c..HEAD -- src/time-series/resolution.ts src/time-series/resolution.test.ts src/plugins/builtin/chart-composer/pane.tsx src/plugins/builtin/chart-composer/settings.ts src/components/ui/tabs.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `43b8e69c`, 2026-09-11

## Why this matters

Charting is the product. The composer lists 1m / 5m / 1h even when the active
provider cannot serve that interval for the selected range. Clicking them either
hides the tab after support loads, or silently rewrites the spec to Auto while
the old bars stay on screen. Traders read that as "granularity does nothing."
TradingView greys unsupported intervals. We already have `Tabs.disabled` and
`getSupportedChartResolutionsForViewport`. Wire them.

## Current state

`src/time-series/resolution.ts` already computes which manual intervals fit a
viewport (`getSupportedChartResolutionsForViewport`, lines 200-226) and whether
a range preset is supported (`isRangePresetSupported`, lines 250-261). Yahoo-
shaped defaults omit 1m / 30m / 45m / 4h:

```163:171:src/time-series/resolution.ts
export const DEFAULT_CHART_RESOLUTION_SUPPORT: ChartResolutionSupport[] = normalizeChartResolutionSupport([
  { resolution: "5m", maxRange: "1W" },
  { resolution: "15m", maxRange: "1M" },
  { resolution: "1h", maxRange: "3M" },
  { resolution: "1d", maxRange: "5Y" },
  { resolution: "1wk", maxRange: "ALL" },
  { resolution: "1mo", maxRange: "ALL" },
]);
```

`src/plugins/builtin/chart-composer/pane.tsx` **hides** unsupported intervals
instead of disabling them, and while support is missing it lists **every**
`CHART_RESOLUTIONS` value. Then a `useEffect` snaps an unsupported authored
interval back to `"auto"`:

```215:227:src/plugins/builtin/chart-composer/pane.tsx
  const availableResolutions = useMemo<ChartResolution[]>(() => {
    if (!resolution.resolutionSupport) {
      if (!resolution.loading) return RESOLUTIONS;
      return spec.viewport.resolution === "auto"
        ? ["auto"]
        : ["auto", spec.viewport.resolution];
    }
    const supported = new Set(getSupportedChartResolutionsForViewport(
      spec.viewport.range,
      resolution.resolutionSupport,
      spec.viewport.dateWindow,
    ));
    return RESOLUTIONS.filter((value) => value === "auto" || supported.has(value));
  }, [ ... ]);
```

```428:436:src/plugins/builtin/chart-composer/pane.tsx
  useEffect(() => {
    if (
      spec.viewport.resolution === "auto"
      || availableResolutions.includes(spec.viewport.resolution)
    ) {
      return;
    }
    setResolution("auto");
  }, [availableResolutions, setResolution, spec.viewport.resolution]);
```

Range tabs are always enabled (`RANGE_TABS` at pane.tsx:81, rendered 616-619).
`isRangePresetSupported` is unused by the pane.

`src/components/ui/tabs.tsx` already supports `disabled?: boolean` (line 22).
Disabled tabs use `colors.textMuted`, ignore click, and are skipped by keyboard
navigation (lines 103, 128, 403, 438).

Settings (`src/plugins/builtin/chart-composer/settings.ts:382-390`) still lists
every `CHART_RESOLUTIONS` value. Leave the settings select as-is except for a
one-line description that unsupported intervals stay Auto. Do not make settings
dynamic.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `bun test src/time-series/resolution.test.ts src/time-series/resolve.test.ts` | all pass |

This repo uses Bun, not pnpm. Commit style: `fix: ...` (see `git log`).

## Scope

**In scope**:
- `src/time-series/resolution.ts`
- `src/time-series/resolution.test.ts`
- `src/plugins/builtin/chart-composer/pane.tsx`

**Out of scope**:
- Yahoo/Cloud support maps (plan 077)
- `settings.ts` option lists (description-only if you touch it; prefer not to)
- CLI `src/cli/pane-functions/capabilities.ts`
- Rasterizer, Lightweight Charts, live quotes
- Do not disable / turn off the kitty renderer

## Git workflow

- Branch: `advisor/076-disable-unsupported-chart-intervals`
- Commit: `fix: disable unsupported chart interval and range tabs`
- Do NOT push or open a PR.

## Steps

### Step 1: Add choice helpers on the resolution module

In `src/time-series/resolution.ts`, add two pure functions (export them):

```ts
export function chartResolutionTabChoices(
  range: TimeRange,
  support: readonly ChartResolutionSupport[] | undefined,
  dateWindow?: { start: string | Date; end: string | Date },
): Array<{ resolution: ChartResolution; enabled: boolean }>

export function chartRangeTabChoices(
  support: readonly ChartResolutionSupport[] | undefined,
): Array<{ range: TimeRange; enabled: boolean }>
```

Rules:
- When `support` is missing or empty, use `DEFAULT_CHART_RESOLUTION_SUPPORT`.
  Never treat "no support yet" as "every interval is available."
- `chartResolutionTabChoices` returns **every** `CHART_RESOLUTIONS` entry in
  order. `"auto"` is always `enabled: true`. A manual interval is enabled iff
  it appears in `getSupportedChartResolutionsForViewport(range, effectiveSupport, dateWindow)`.
- `chartRangeTabChoices` returns every `TIME_RANGES` entry. A range is enabled
  iff `isRangePresetSupported(range, effectiveSupport)`.
- Keep `"auto"` first in the resolution list.

**Verify**: `bun test src/time-series/resolution.test.ts` still passes (you will
add tests in step 2).

### Step 2: Tests for the helpers

In `src/time-series/resolution.test.ts`, model after the existing
`"exposes only intervals that can cover and chart the authored viewport"` test.

Use an explicit support fixture in tests, not live DEFAULT contents (plan 077
will add 1m to DEFAULT and would break hard-coded DEFAULT snapshots):

```ts
const yahooShaped = [
  { resolution: "5m" as const, maxRange: "1W" as const },
  { resolution: "15m" as const, maxRange: "1M" as const },
  { resolution: "1h" as const, maxRange: "3M" as const },
  { resolution: "1d" as const, maxRange: "5Y" as const },
  { resolution: "1wk" as const, maxRange: "ALL" as const },
  { resolution: "1mo" as const, maxRange: "ALL" as const },
];
```

Add:
1. Range `"1Y"` + `yahooShaped`: enabled resolutions are `auto`, `1d`, `1wk`,
   `1mo`. `1m` and `1h` are present but `enabled: false`.
2. Range `"1D"` + `yahooShaped`: `5m` enabled. `1m` disabled (not in fixture).
   `1d` disabled (too coarse for 1D — match `getSupportedChartResolutionsForViewport`).
3. `chartResolutionTabChoices("1Y", undefined)` equals
   `chartResolutionTabChoices("1Y", DEFAULT_CHART_RESOLUTION_SUPPORT)` — missing
   support uses DEFAULT, not the full enum-as-enabled.
4. `chartRangeTabChoices(yahooShaped)`: `"1D"` is disabled because the 1D
   preset is `"1m"` and the fixture does not list 1m. `"1Y"` is enabled
   (preset `1d`). Do **not** change `RANGE_PRESET_RESOLUTION`.

**Verify**: `bun test src/time-series/resolution.test.ts` → all pass including
the new cases.

### Step 3: Wire the composer pane

In `src/plugins/builtin/chart-composer/pane.tsx`:

1. Replace `availableResolutions` / `resolutionTabs` with
   `chartResolutionTabChoices(spec.viewport.range, resolution.resolutionSupport, spec.viewport.dateWindow)`.
   Map to Tabs items: `{ label: value.toUpperCase(), value, disabled: !enabled }`.
2. Keep `"auto"` label as `AUTO` (existing `.toUpperCase()` is fine).
3. **Delete** the `useEffect` that calls `setResolution("auto")` when the
   authored interval is missing from `availableResolutions`.
4. Range tabs: replace the static `RANGE_TABS` usage with
   `chartRangeTabChoices(resolution.resolutionSupport)` mapped to
   `{ label: \`${index + 1}:${range}\`, value: range, disabled: !enabled }`.
   Keep the `1:` … `8:` prefix.
5. `openResolutionPicker` / `openRangePicker` ChoiceDialog: only offer
   **enabled** choices (the dialog has no disabled styling). Selecting still
   goes through `setResolution` / `setRange`.
6. `onSelect` for Tabs already no-ops disabled tabs. Do not add a second guard
   unless you also keep the dialog path honest.
7. `resolutionTabsWidth` must still include disabled labels so the row does not
   jump when support loads.

**Verify**: `bun test src/time-series/resolution.test.ts src/time-series/resolve.test.ts` → all pass.

## Test plan

- New unit tests in `src/time-series/resolution.test.ts` as listed in step 2.
- Do not add a pane render test unless an existing composer pane test file
  appears; there is no `pane.test.tsx` today.
- Pattern: `src/time-series/resolution.test.ts`.

Verification: `bun test src/time-series/resolution.test.ts src/time-series/resolve.test.ts`

## Done criteria

- [ ] `chartResolutionTabChoices` / `chartRangeTabChoices` exist and are tested
- [ ] Composer header still lists 1m/1h/etc, with `disabled: true` when unsupported
- [ ] Missing `resolutionSupport` uses DEFAULT, not the full enum
- [ ] The snap-to-auto `useEffect` in `pane.tsx` is gone
- [ ] Range tabs use `disabled` via `isRangePresetSupported`
- [ ] `bun test src/time-series/resolution.test.ts src/time-series/resolve.test.ts` exits 0
- [ ] No files outside the in-scope list are modified

## STOP conditions

- `Tabs` no longer honors `disabled` (it did at `tabs.tsx:22,103,438`).
- `isRangePresetSupported("1D", DEFAULT)` is true — then DEFAULT has gained 1m
  (plan 077). Still disable based on the helper; do not hard-code 1D.
- A change appears to require editing Yahoo support maps.

## Maintenance notes

Plan 077 will add 1m to DEFAULT. These helpers should automatically enable 1m
on 1D once that lands. Reviewers: confirm disabled tabs are visible (muted),
not omitted. Do not resurrect the snap-to-auto effect.
