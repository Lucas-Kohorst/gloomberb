# Plan 071: Add a machine-checkable QA invariant layer over the existing pane-function harness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- src/cli/pane-functions/ src/remote/resources.ts src/components/layout/pane/footer/index.tsx .github/workflows/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none to start. Its CI gate stays advisory until `plans/072-ci-baseline-repair.md` turns CI green. Invariant `data-dir-isolation` will FAIL until `plans/068-data-dir-isolation-bypasses.md` lands — that is intended (see Step 6).
- **Category**: tests
- **Planned at**: commit `09e9b9a3`, 2026-08-29

## Why this matters

Two bugs shipped recently that no unit test could have caught, because both were
about **reported data being wrong**, not about a function returning the wrong
value:

- A prediction-market group header showed `69%` while its own first row showed
  `51%`. The header and the rows were each internally consistent; they disagreed
  with each other.
- The Brokers pane header read `0 profiles · 0 connected · 0 issues` while six
  broker portfolio tabs were rendered beside it. The header was arithmetically
  honest about an empty array; the six tabs were orphans nothing reconciled.

Both are *cross-checkable*: a number displayed in one place contradicted
something displayed next to it. That class of bug is invisible to unit tests and
obvious to an oracle that reads the rendered surface and asserts a relationship.

This repo already has the hard part — a headless pane-function harness
(`src/cli/pane-functions/`, ~4.3k lines) that renders panes without a terminal
and emits structured JSON with quality flags. What it lacks is a **layer of
invariants** asserted against that output, and a way to run them identically
from an agent's shell, a PR check, and a schedule. This plan adds that layer.

After this plan there is one command, `bun run qa:invariants`, that an agent or
CI runs to get a pass/fail list of named, cross-checking assertions about the
app's own reported data.

## Current state

> **CRITICAL BASELINE WARNING.** This repo's CI is currently RED on `main`. At
> clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29
> typecheck errors per sub-project** (`bun run typecheck` exits 2). These
> failures are **PRE-EXISTING and NOT caused by your change.** Do NOT try to fix
> them — that is plan 072's job. Record your baseline first:
> `bun test 2>&1 | tail -5` and `bun run typecheck 2>&1 | tail -20`. Your done
> criteria is that you do not **increase** these counts.
>
> This baseline is also **why this plan's CI gate must start non-blocking.** A
> new required check added to a permanently-red pipeline teaches everyone to
> ignore checks. See Step 7.

### What already exists (build on this — do not build a parallel harness)

`src/cli/pane-functions/` — a headless pane-function layer, wired into the CLI at
`src/cli/index.ts` as three commands (verified at lines 113, 124, 135):

| Command | Purpose |
|---|---|
| `gloomberb fn <target>` | Runs a pane's data path headlessly, emits a structured JSON report |
| `gloomberb shot <target>` | Renders a pane headlessly (Chrome) and emits render-quality flags |
| `gloomberb catalog` | Lists capabilities and their machine-readable readiness |

File sizes, for orientation: `report.ts` 860, `screenshot.ts` 1075, `capabilities.ts`
556, `options.ts` 269, `catalog.ts` 278, `index.ts` 181, `resolver.ts` 160,
`discovery.ts` 144, `data.ts` 103.

**The report shape is the oracle substrate.** Verified at
`src/cli/pane-functions/report.ts:51-68`:

```ts
export interface PaneFunctionReportData {
  kind: string;
  target: string;
  capabilityId: string;
  symbols: string[];
  options: NormalizedPaneFunctionOptions;
  rowCount: number;
  empty: boolean;
  complete: boolean;
  unavailableSymbols: string[];
  [key: string]: unknown;
}

export interface PaneFunctionReport {
  data: PaneFunctionReportData;
  text: string;
}
```

And how those flags are derived, `report.ts:71-88`:

```ts
  return {
    target: resolved.token,
    capabilityId: resolved.capability.id,
    symbols,
    options: resolved.options,
    rowCount,
    empty: rowCount === 0,
    complete: unavailableSymbols.length === 0,
    unavailableSymbols,
  };
```

Note `complete` means "nothing was unavailable" and `empty` means "zero rows".
**A report with `empty: true` and `complete: true` and no `unavailableSymbols` is
self-contradictory**: it claims full success while showing nothing. That is a
free invariant.

Each capability declares its own machine-readable readiness. Verified shape from
`src/cli/pane-functions/capabilities.ts` (excerpt around lines 109-118):

```ts
    botSafe: true,
    tickerCardinality: "none",
    aliases: ["custom chart", "mixed series chart", "chart composer", "economic chart"],
    intents: ["chart arbitrary market fundamental valuation and economic series together"],
    outputKind: "chart-series",
    reportReadiness: "ready",
    screenshotReadiness: "ready",
    dataRequirements: ["data required by each authored chart series"],
    limitations: ["FRED observations do not include historical vintage availability dates."],
```

**Coverage gap, measured:** `grep -c "botSafe: true" src/cli/pane-functions/capabilities.ts`
returns **13**, and `grep -c 'reportReadiness: "ready"'` also returns **13**, while
`grep -rl "panes: \[" src/plugins/builtin/*/index.tsx | wc -l` returns **63**
pane-declaring builtin modules. So roughly 13 of 63 pane modules are reachable
by the headless harness. Re-run these three commands yourself — if the numbers
have moved, use yours.

### The remote-control surface (the other readable seam)

`src/remote/resources.ts` exposes ~17 `app://` resources plus `ui://tree`, served
over a localhost-only HTTP server. Verified in `src/remote/server.ts`: binds
`127.0.0.1` port `0` (line ~28), mints a `randomUUID()` bearer token (line ~21),
rejects mismatched `authorization` (line ~88).

**Unbound footer hints are already detectable through it.** Verified at
`src/components/layout/pane/footer/index.tsx:173-186`:

```tsx
function HintView({ hint, prefixSpace }: { hint: PaneHint; prefixSpace: boolean }) {
  useRemoteUiNode({
    role: "pane-hint",
    label: `${hint.key}${hint.label}`,
    disabled: hint.disabled,
    actions: {
      press: hint.onPress ? () => hint.onPress?.() : undefined,
    },
    metadata: {
      id: hint.id,
      key: hint.key,
      label: hint.label,
    },
  });
```

Because `press` is `undefined` when there is no handler, a hint with no binding
appears in the node tree with an **empty actions set**. AGENTS.md states plainly:
*"Bind the hinted key. A footer hint with no handler is a bug."* So that
invariant is a handful of lines over data that already exists.

### Reading cell values: use the `readRows` action, never the metadata

`src/components/ui/data-table/index.tsx` publishes table **metadata** that
deliberately contains no row data (lines ~89-95 — `sortColumnId`,
`sortDirection`, `columns`, `rowCount`, `selectedId`). That is intentional and
protected by a test: `src/components/ui/data-table/index.test.tsx` asserts
`expect(tableNode?.metadata).not.toHaveProperty("rows")`. Plan 006 memoized this
registration, and putting `items` into the memo dependencies would re-register
the node on every quote tick. **Do not add row data to the metadata.**

Cell values are instead available on demand through a **`readRows` action** on
the same node. It reads a live props ref outside the memo, so it costs nothing
until called and adds nothing to the pushed snapshot:

```ts
      readRows: (input: unknown) => {
        // ...bounded by start/limit (default 50, max 500)...
        return { rowCount: total, start, returned: rows.length, rows };
      },
```

Each returned row is:

```ts
{
  index: number;
  key: string;
  selected: boolean;
  sectionHeader?: string;   // present only on rows that begin a group
  cells: Record<string, string>;  // columnId -> rendered cell text
}
```

Invoke it over the remote surface with the `ui.invoke` operation
(`nodeId`, `action: "readRows"`, `input: { start, limit }`). Action return values
propagate: `RemoteUiAction` is typed `(input?: unknown) => unknown | Promise<unknown>`
and `src/remote/controller.ts` surfaces the result under `result`.

`sectionHeader` carries the **group header text** and `cells` carries the
**rendered cell text**, which together make value-accuracy invariants possible —
including the `group-header-equals-first-child` check in Step 6b that would have
caught the `69%`-vs-`51%` bug.

Two constraints when using it:
- Always pass an explicit `limit`. The default is 50 and the cap is 500; do not
  assume you received the whole table. Use the returned `rowCount` versus
  `returned` to detect truncation, and treat a truncated read as **skipped**
  rather than passed for any invariant that needs the full table.
- A cell whose renderer depends on render-time context is omitted from `cells`
  rather than throwing. So a missing column key means "not readable", **not**
  "empty string" — an invariant must not treat the two as the same.

### Conventions

- TypeScript, 2-space indent, semicolons, `import type` for type-only imports.
- Tests use `bun:test` (`describe` / `it` / `expect`).
- Comments explain **why**, never what.
- New CLI-adjacent code follows the structure of `src/cli/pane-functions/` —
  small focused modules, types exported from the module that owns them.
- AGENTS.md on tests: *"add or keep a test only when it protects behavior that is
  easy to break and hard to catch in review."* The invariants themselves are the
  product here; give each invariant a small unit test over a fixture, not a
  sprawling integration suite.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (5 projects) | `bun run typecheck` | no increase over recorded baseline |
| Full tests | `bun test` | no increase over recorded baseline (~91 failing) |
| This plan's tests | `bun test src/qa/` | all pass |
| Capability catalog | `bun run src/cli/entry.ts catalog` | exits 0, lists capabilities |
| One pane report | `bun run src/cli/entry.ts fn <target> --json` | exits 0, emits JSON (confirm the real flag name from `src/cli/pane-functions/options.ts`) |
| The new runner | `bun run qa:invariants` | exits 0 when all offline invariants hold |

Confirm the exact `fn` / `catalog` invocation and JSON flag by reading
`src/cli/index.ts:105-145` and `src/cli/pane-functions/options.ts` **before**
writing the runner. Do not guess the flag names.

## Scope

**In scope** (create unless noted):
- `src/qa/invariants/` — new directory: `types.ts`, `registry.ts`, one file per
  invariant, `runner.ts`
- `src/qa/invariants/*.test.ts` — unit tests per invariant
- `scripts/qa-invariants.ts` — CLI entry the package script calls
- `package.json` — add the `qa:invariants` script only
- `.github/workflows/qa-invariants.yml` — new, **non-blocking** (Step 7)
- `.github/workflows/qa-canary.yml` — new, scheduled (Step 8)

**Out of scope** (do NOT touch):
- `src/components/ui/data-table/index.tsx` — the `readRows` action already exists
  and is what you consume. Do **not** add cell values to the registration
  metadata (`plans/006` memoized it deliberately, and a test asserts
  `metadata` has no `rows`). If you need a field `readRows` does not return,
  report it rather than moving data into the metadata.
- Any HTTP recording/replay or cassette layer. There is none today and building
  one is explicitly out of scope for this plan.
- `src/remote/server.ts` — transport auth and binding are correct.
- `.github/workflows/verify.yml` and `.github/workflows/pr-checks.yml` — do not
  add invariants to the existing required checks, and do not try to fix their
  redness (plan 072). Note `plans/README.md` records TECH-03 (consolidating the
  two duplicate workflows) as **rejected** — do not consolidate them.
- The 91 pre-existing test failures and the typecheck errors.
- Fixing any bug an invariant discovers. Report it; a failing invariant that
  documents a real bug is a successful outcome of this plan.

## Git workflow

- Branch: `advisor/071-qa-invariant-layer`
- Conventional commits. Real examples from `git log`:
  `fix(chat): keep DMs when the public channel catalog refreshes`,
  `feat(cftc): stacked DCM-products-by-exchange chart`. Suggested:
  `feat(qa): add invariant layer over pane-function reports`.
- Commit per step so each invariant lands independently reviewable.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Define the invariant contract

Create `src/qa/invariants/types.ts`. An invariant is a **named, pure predicate
over evidence already produced by the harness** — never a function that fetches
on its own. Keeping them pure is what lets the same invariant run offline in CI
and live in the canary.

Target shape:

```ts
export type InvariantMode = "offline" | "live";

export interface InvariantViolation {
  /** Stable identifier so CI output can be diffed across runs. */
  subject: string;
  message: string;
  /** Evidence excerpt. Must never include credential material. */
  detail?: unknown;
}

export interface InvariantResult {
  id: string;
  ok: boolean;
  skipped?: string;
  violations: InvariantViolation[];
}

export interface Invariant<TEvidence> {
  id: string;
  /** One sentence, present tense, describing what must be true. */
  describes: string;
  mode: InvariantMode;
  /** Why this exists — cite the bug class it guards against. */
  rationale: string;
  check(evidence: TEvidence): InvariantViolation[];
}
```

**Verify**: `bun run typecheck` → no increase over baseline.

### Step 2: Invariant `capability-report-honest` (offline)

Create `src/qa/invariants/capability-report-honest.ts`.

For every capability with `botSafe: true` and `reportReadiness: "ready"`, run
`gloomberb fn` and assert the report is not self-contradictory:

- `empty === (rowCount === 0)` — the derived flags agree.
- `complete === (unavailableSymbols.length === 0)` — likewise.
- **Not** (`empty === true` && `complete === true` && `unavailableSymbols` is
  empty). A capability that claims complete success while producing zero rows is
  either broken or should be reporting an unavailable reason.
- `capabilityId` in the report matches the capability that was requested.

This is the invariant that catches "the pane renders but the data silently
didn't arrive" — the shape of the original frozen-odds bug.

Because this one *does* execute pane data paths, it may need network. Mark it
`mode: "offline"` **only** if you can drive it from cached/fixture data;
otherwise mark it `"live"` and let the canary own it. Determine this by reading
how `src/cli/pane-functions/data.ts` sources data and whether a cache path
exists. State your finding in your report — do not silently mark a
network-dependent invariant as offline, because that is how the PR gate becomes
flaky.

**Verify**: `bun test src/qa/invariants/capability-report-honest.test.ts` → passes
against a fixture report object with a known-contradictory case.

### Step 3: Invariant `footer-hint-bound` (offline)

Create `src/qa/invariants/footer-hint-bound.ts`.

Evidence: the pane-hint nodes from the remote UI tree (`role: "pane-hint"`).
Assert every non-disabled hint node exposes a `press` action. Per the excerpt in
"Current state", an unbound hint registers `press: undefined`, so this is
directly observable.

Cite AGENTS.md in `rationale`: *"Bind the hinted key. A footer hint with no
handler is a bug."*

A prior audit swept ~60 footer call sites and found **no** currently-unbound
hints, so this invariant should **pass on day one**. That is the point — it is a
regression guard for a rule the codebase currently satisfies. If it fails, you
have found a real bug: report it, do not fix it here.

**Verify**: `bun test src/qa/invariants/footer-hint-bound.test.ts` → passes;
include a fixture with one unbound hint and assert it is reported.

### Step 4: Invariant `footer-hint-vocabulary` (offline)

Create `src/qa/invariants/footer-hint-vocabulary.ts`.

Assert no pane-hint node uses a key the pane contract forbids. The rule is in
**PLUGINS.md** (not AGENTS.md — cite it correctly), quoted verbatim:

> Do not register basic navigation hints. Pane hints must omit `Esc`, `Enter`,
> arrows, `up/down`, `left/right`, `j`, `k`, `j/k`, and n hints such as `h/l`.
> Keep only pane-specific actions such as `[r]efresh`, `[/]search`, `[f]ilter`,
> `[Ctrl+S]save`, `[Shift+R]force refresh`, or chart controls.

Compare case-insensitively on the hint's `key` metadata field. Allow `Ctrl+S`
and other modifier combinations that PLUGINS.md explicitly permits — a naive
match on `"s"` would wrongly flag `Ctrl+S`.

**This invariant will FAIL on the current tree**: roughly 12 violating hints
across ~6 panes are known (`broker-manager/footer.ts`,
`account-management/ai-providers-tab.tsx`, `plugin-market/pane.tsx`,
`byok/pane.tsx`, `ai/screener/footer.ts`). `plans/070-pane-contract-cleanups.md`
fixes them. Do **not** fix them here and do **not** weaken the invariant to make
it pass. Record the expected failures in your report and note the dependency on
070.

**Verify**: `bun test src/qa/invariants/footer-hint-vocabulary.test.ts` → passes,
with a fixture proving both that `Esc` is flagged and that `Ctrl+S` is not.

### Step 5: Invariant `counter-reconciles` (offline)

Create `src/qa/invariants/counter-reconciles.ts`. **This is the highest-value
invariant in the plan** — it is the one that catches the Brokers
`0 profiles · 6 tabs` class of bug.

The check: when a pane's header or summary text states a count of the things its
table lists, that number must equal the table's `rowCount`.

You cannot infer which counter maps to which table automatically, and guessing
will produce false positives that destroy trust in the whole layer. So make the
mapping **explicit and declarative**: a small registry of
`{ paneId, counterNodePattern, tableNodeId, label }` entries, starting with two
or three panes where the relationship is unambiguous (the Brokers pane is the
motivating case). Parse the integer out of the counter node's label with a
narrow, anchored regex and compare to the table node's `rowCount` metadata.

Design requirements:
- An entry whose nodes are not present in the evidence must report
  **skipped**, not failed. A pane that is closed is not a violation.
- Zero-vs-zero must pass; the bug is a *mismatch*, not a zero.
- If a counter legitimately counts something other than the table rows (for
  example "0 connected" counts a subset), do **not** add it to the registry.
  Only add counters that must equal the row count exactly.

Document in the file's header comment **why** the mapping is manual: automatic
inference produced ambiguity, and a false-positive invariant is worse than a
missing one because it trains people to ignore failures.

**Verify**: `bun test src/qa/invariants/counter-reconciles.test.ts` → passes,
with fixtures for match, mismatch, and missing-node-skipped.

### Step 6: Invariant `data-dir-isolation` (offline)

Create `src/qa/invariants/data-dir-isolation.ts`.

Assert that running a harness command with `GLOOMBERB_DATA_DIR` pointed at a
throwaway directory produces **no writes under the real `~/.gloomberb`**.

Implementation approach: record the modification times (or a directory listing
snapshot) of `~/.gloomberb` before and after invoking a harness command with an
isolated data dir, and report any new or modified entry. Do **not** delete or
modify anything under the real `~/.gloomberb` — this invariant observes only.
Treat a missing `~/.gloomberb` as a pass.

**This invariant will FAIL on the current tree.** Two known bypasses write under
the real home directory regardless of the override:
`src/plugins/builtin/ai/run-trace.ts:5` computes its path from `homedir()` at
module import time, and `src/plugins/builtin/ai/tools.ts:78` reads
`process.env.HOME` directly instead of the canonical resolver.
`plans/068-data-dir-isolation-bypasses.md` fixes both. Do **not** fix them here.
This is the invariant proving 068 is needed and, later, that it worked.

**Verify**: `bun test src/qa/invariants/data-dir-isolation.test.ts` → passes;
the invariant's own logic is tested over a fixture of before/after listings, not
by actually mutating the home directory.

### Step 6b: Invariant `group-header-equals-first-child` (offline)

Create `src/qa/invariants/group-header-equals-first-child.ts`. **This is the
value-accuracy invariant** — the one that catches the class of bug where a group
header disagrees with the rows beneath it.

The motivating incident: a prediction-market group header displayed `69%` while
its own first child row displayed `51%`. Each was internally consistent; they
contradicted each other. The root cause turned out to be stale duplicate markets
persisted under a legacy id scheme, which could never take a live quote, so the
header's number never moved.

The check: for a grouped table, when a row carries a `sectionHeader`, any value
embedded in that header text must agree with the corresponding cell of the
**first row of that group**.

Evidence comes from the `readRows` action described in "Current state". Walk the
returned rows in order; each row with a `sectionHeader` opens a new group and is
itself that group's first child.

Design requirements, in order of importance:

1. **Do not attempt to parse arbitrary header text.** Like `counter-reconciles`,
   use an explicit declarative registry of
   `{ paneId, headerValuePattern, columnId }` entries, so you only compare where
   the relationship is known to hold. A false positive here is worse than no
   check, because it trains people to ignore the whole layer.
2. Extract the value from the header with a narrow anchored regex and compare it
   to the named column's cell text on the same row. Compare **normalised
   strings**, not floats — the header and the cell are both already-formatted
   display text, and re-parsing them into numbers invents precision that is not
   there. If a percentage is formatted differently in the two places (`51%` vs
   `51.0%`), normalise explicitly and document the rule.
3. A header with no extractable value → **skipped**, not failed.
4. A truncated read (`returned < rowCount`) → **skipped** for any group that may
   be cut off. Never report a violation you cannot see the whole group for.
5. If a column key is absent from `cells` (the renderer needed render context),
   that is **skipped**, not a mismatch. See the constraint in "Current state".

Seed the registry with the prediction-markets table, since that is the pane the
bug occurred in. Read `src/plugins/prediction-markets/rows.ts` and
`src/plugins/prediction-markets/metrics.ts` to learn how the header and the
child probability are each produced before you assert they must match — if they
are computed from genuinely different sources by design, say so and do not add
the entry.

**Verify**: `bun test src/qa/invariants/group-header-equals-first-child.test.ts`
→ passes, with fixtures for: agreement, the `69%`-over-`51%` mismatch, a header
with no parseable value (skipped), a truncated read (skipped), and a missing
column key (skipped).

### Step 7: Build the runner and wire a NON-BLOCKING CI check

Create `src/qa/invariants/registry.ts` (exports the array of invariants),
`src/qa/invariants/runner.ts` (executes a selected mode, aggregates
`InvariantResult[]`), and `scripts/qa-invariants.ts` (the CLI entry).

Runner requirements:
- `--mode offline` (default) runs only `mode: "offline"` invariants. `--mode live`
  runs the live ones.
- Human-readable output by default; `--json` for machine consumption. An agent
  and CI must be able to consume the same run.
- Exit code: `0` when every non-skipped invariant passes, non-zero otherwise.
  Add `--report-only` that always exits 0 while still printing violations —
  needed for the non-blocking rollout below.
- Output must name each invariant by `id` and print `describes` on failure, so a
  failure is self-explaining without reading the source.
- **Never print credential values.** The `detail` field is written by invariant
  authors; add a guard or a documented rule that `detail` carries locations and
  types only. Note that plan 069 redacts credentials from
  `app://snapshot` / `app://config`; until it lands, avoid dumping whole config
  objects into `detail`.

Add to `package.json` scripts (this is the only `package.json` change):

```json
    "qa:invariants": "bun run scripts/qa-invariants.ts",
```

Create `.github/workflows/qa-invariants.yml`. It **must not block merges yet**.
Use the repo's existing setup action — verified present and used by
`verify.yml` as `- uses: ./.github/actions/setup-bun`. Model the workflow on
`.github/workflows/verify.yml`, which currently reads:

```yaml
name: Verify
on:
  push:
  pull_request:
permissions:
  contents: read
concurrency:
  group: verify-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-bun
      - name: Typecheck production runtimes
        run: bun run typecheck
```

Your new workflow runs `bun run qa:invariants --mode offline --report-only` with
`continue-on-error: true`. Add a comment in the YAML stating explicitly that the
check is advisory until CI is green (plan 072) and until 068 and 070 land, and
that flipping it to blocking is a deliberate follow-up step.

**Why non-blocking matters here**: `plans/README.md` records TECH-04 as rejected
precisely because making a permissive gate strict while a backlog exists risks
blocking PRs. The same reasoning applies — ship the signal first, enforce later.

**Verify**: `bun run qa:invariants --mode offline` → runs, prints a named result
per invariant, and reports the expected failures from Steps 4 and 6.
`bun run qa:invariants --mode offline --report-only; echo $?` → prints `0`.

### Step 8: Add the scheduled live canary

Create `.github/workflows/qa-canary.yml`: `on: schedule` (a daily cron) plus
`workflow_dispatch` for manual runs. It runs `bun run qa:invariants --mode live`.

Live invariants belong **only** here, never in the PR gate — the operator's
explicit decision, because live third-party APIs make a PR gate flaky and a
flaky required check is worse than no check.

Seed the live set with one invariant, `quote-timestamp-advances`: sample a live
quote twice with a delay and assert the timestamp advanced. This is the direct
automated guard for the watchlist bridge that `plans/066` repairs — the original
frozen-odds bug was exactly "a quote that never advances", and it shipped
because nothing watched for it.

Make the canary tolerant of third-party outages: an invariant that cannot obtain
data must report **skipped with a reason**, not fail. A canary that cries wolf
when Polymarket is down gets muted, and then it protects nothing.

Do not add secrets to this workflow. If a live invariant needs credentials to be
meaningful, mark it skipped in CI and note it in your report rather than wiring
secrets into a new workflow.

**Verify**: `bun run qa:invariants --mode live` locally → runs and either passes
or reports skips with reasons. Validate the workflow YAML parses (for example
with `bunx --yes yaml-lint .github/workflows/qa-canary.yml`, or any equivalent
available; if no linter is available, say so rather than claiming validation).

### Step 9: Document coverage honestly

Create `src/qa/invariants/README.md` recording:
- Each invariant: `id`, what it asserts, mode, and the bug class it guards.
- The measured harness coverage (13 bot-safe capabilities of 63 pane-declaring
  modules at the time of writing) and the fact that invariants only see panes
  the harness can reach.
- **What this layer cannot catch**, stated plainly: value-level accuracy. Because
  `DataTable` metadata carries no cell values, an invariant cannot compare a
  group header's percentage to its first child's percentage — the exact `69%` vs
  `51%` bug remains outside automated reach. Name the follow-up that would close
  it (expose row values, preserving `plans/006`'s memoization).

**Verify**: the file exists and its invariant list matches `registry.ts`
(`grep -c "^### " src/qa/invariants/README.md` equals the registry length).

## Test plan

- One test file per invariant, each over **fixture evidence objects**, covering:
  the passing case, the specific violation the invariant exists to catch, and
  the skip case where evidence is absent.
- `src/qa/invariants/runner.test.ts`: exit-code semantics (`0` all-pass, non-zero
  on violation, `0` under `--report-only`) and that skips do not fail a run.
- Structural pattern to follow: `src/cli/pane-functions/index.test.ts` (217
  lines) and `src/cli/pane-functions/data.test.ts` (17 lines) — read both.
- Do **not** write tests that hit the network. Live behaviour is the canary's
  job; the invariant *logic* must be testable offline from fixtures.
- Verification: `bun test src/qa/` → all pass.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` error count is **not higher** than the baseline you recorded
- [ ] `bun test` failure count is **not higher** than the baseline you recorded
- [ ] `bun test src/qa/` passes
- [ ] `bun run qa:invariants --mode offline --json` emits valid JSON with one
      entry per registered invariant
- [ ] `bun run qa:invariants --mode offline --report-only; echo $?` prints `0`
- [ ] `bun run qa:invariants --mode offline` exits non-zero and names the
      expected pre-existing violations (footer-hint-vocabulary, data-dir-isolation)
- [ ] `.github/workflows/qa-invariants.yml` exists with `continue-on-error: true`
      and a comment explaining the advisory status
- [ ] `.github/workflows/qa-canary.yml` exists with `schedule` + `workflow_dispatch`
      and contains no secrets
- [ ] `src/qa/invariants/README.md` documents every invariant and states the
      value-accuracy limitation
- [ ] `git diff --stat package.json` shows only the added `qa:invariants` script
- [ ] `git status --short` shows no modification to
      `src/components/ui/data-table/index.tsx`, `verify.yml`, or `pr-checks.yml`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `PaneFunctionReportData` shape or the footer `HintView` excerpt does not
  match live code.
- The `fn` / `catalog` commands cannot be invoked non-interactively, or emit no
  machine-readable output — the whole plan rests on that. Report what they
  actually emit.
- An invariant cannot be implemented without network access in the PR gate, and
  you cannot move it to the live canary without making it meaningless.
- `counter-reconciles` produces false positives you cannot eliminate with an
  explicit registry. A false-positive invariant is worse than none — report and
  ship the layer without it rather than shipping noise.
- Implementing an invariant appears to require exposing DataTable cell values.
  That is out of scope by operator decision; report it as a deferred follow-up.
- You find yourself fixing product bugs an invariant surfaced. Report them
  instead; 066, 068, and 070 own the known ones.
- Test or typecheck counts **increase** above your recorded baseline.

## Maintenance notes

- **The load-bearing property is that invariants are pure over supplied
  evidence.** Keep it. The moment an invariant fetches its own data, it stops
  being runnable identically by an agent, a PR check, and the canary.
- **What a reviewer should scrutinise**: that no live invariant leaked into the
  PR-gate workflow; that `continue-on-error: true` is present until the gate is
  deliberately promoted; that `detail` payloads cannot carry credentials.
- **Promoting the gate to blocking** is the intended follow-up once plan 072
  turns CI green and 068 and 070 clear the two known violations. Do that in its
  own PR so the flip is reviewable and revertible.
- **Value accuracy is now reachable, via a pull not a push.** `readRows` was
  added to `DataTable` specifically to unblock Step 6b. It deliberately reads a
  live props ref *outside* the registration memo, so it neither re-fires the memo
  that `plans/006` added nor enlarges the pushed snapshot. If a future change
  moves row data into the registration metadata "for convenience", it will
  reintroduce exactly the performance problem 006 fixed — the test asserting
  `metadata` has no `rows` is the guard, keep it.
- **The `readRows` cap is a correctness boundary, not just a performance knob.**
  Default 50, max 500. An invariant that silently accepts a truncated read will
  report false passes on long tables. Always compare `returned` against
  `rowCount`.
- **Also deferred — record/replay cassettes.** There is no HTTP recording layer
  in this repo; `mock.module()` is the only mechanism and it leaks process-wide.
  Deterministic offline replay of live data paths would let more invariants move
  into the PR gate. Out of scope here by operator decision.
- **Coverage will rot silently.** Only ~13 of 63 pane modules are harness-
  reachable. Consider a future invariant asserting that every pane-declaring
  module either has a bot-safe capability or an explicit, reasoned exemption —
  that converts coverage from a number nobody watches into a check.
