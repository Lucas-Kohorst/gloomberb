# Plan 072: Restore a green CI baseline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- package.json bunfig.toml src/test-support/ .github/workflows/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Because this plan is *about* the
> failure counts, **always re-measure them yourself** rather than trusting the
> numbers written here.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none. Runs in parallel with everything else. `plans/071-qa-invariant-layer.md`
  keeps its CI check advisory until this plan is DONE.
- **Category**: tests
- **Planned at**: commit `09e9b9a3`, 2026-08-29

## Why this matters

`.github/workflows/verify.yml` and `.github/workflows/pr-checks.yml` both run
`bun run typecheck` and `bun test` unconditionally on every push and pull
request, and both are **currently failing on `main`**. There is no green
baseline.

The cost is not cosmetic. When CI is permanently red:

- A real regression introduced by a PR is indistinguishable from the standing
  noise, so the checks stop being read.
- Every contributor and every automated executor must be told "ignore the 24
  failures and 27 type errors, they are not yours" — which is exactly the
  instruction that lets a genuine new failure slip through.
- Any *new* quality gate is worthless. This is why `plans/071` must ship its
  invariant check as advisory: adding a required check to a red pipeline teaches
  people to ignore checks.

After this plan, `bun test` and `bun run typecheck` both exit 0 on `main`, and
the existing workflows become meaningful signal.

## Current state

### Measured baseline

Measured on the working tree at the time of writing:

```
bun test  →  3872 pass, 24 fail, 14070 expect() calls, 3896 tests across 553 files
bun run typecheck:opentui  →  27 errors, exit 2
```

At **clean HEAD `09e9b9a3`** (measured in a detached worktree, with the
working tree's uncommitted changes absent) the same commands gave **91 test
failures** and **29 typecheck errors** in the `opentui` project.

Two things follow, and both matter:

1. **A large part of the test repair already exists in the working tree.** The
   drop from 91 to 24 came from fixing cross-file test pollution, not from
   fixing 67 individual tests. Two mechanisms did it:
   - `bunfig.toml` `[test] preload` pointing at `src/test-support/setup.ts`,
     which reinstalls a timer-backed `requestAnimationFrame` in `beforeEach`.
     Constructing an OpenTUI renderer replaces `globalThis.requestAnimationFrame`
     and never restores it, so one render test could stall every later file that
     prefers a frame over a timer.
   - Capturing real module namespaces with `await import()` and reinstalling them
     in `afterAll` in the files that call `mock.module()` — which is process-wide
     and permanent in Bun. See `src/remote/controller.test.ts` and
     `src/plugins/builtin/chart-composer/catalog-prefetch.test.ts` for the
     working pattern.

   **If those changes are present when you start, do not undo them.** If they are
   absent (because the working tree was never committed), expect ~91 failures and
   fix the pollution first — it is the highest-leverage step by far.

2. **The counts are not perfectly stable.** An earlier measurement in the same
   session recorded 21 failures where the run above recorded 24. Some failures
   are therefore order- or timing-dependent. Treat count instability as a defect
   in its own right (Step 5), not as measurement noise to average away.

### The 24 failing tests, clustered

Grouped by likely shared cause. Re-derive this list yourself; do not assume it
still matches.

| # | Cluster | Failing tests |
|---|---|---|
| 5 | `PaneFooterBar` | rebuilds translated registrations when the app language changes; hides hints on inactive footers but keeps info visible; renders poll interval on the right after action hints; keeps poll interval visible when the pane is unfocused; omits disabled controls instead of rendering muted hints |
| 4 | `pane selectors` / theme | rerenders theme hook consumers when the theme changes; …when the theme preview changes; falls back to the committed theme when theme preview clears; desktop detached windows apply theme preview messages locally |
| 3 | Connection source inventory | `desktop backend plugin catalog > registers Adjacent Cloud as a data plugin with VoteHub, AI Benchmarks, and Weather`; `connection source registry > reports leftover Yahoo fragment traffic on the Yahoo origin`; `connection source registry > Adjacent Cloud plugin lists one source, not VoteHub/OWID/weather children` |
| 3 | Ticker badges | `ChatContent > renders ticker badges and opens a floating Ticker Research pane on click`; `ChatContent > wraps ticker badges using their rendered width in terminal messages`; `AskAiTab > renders assistant ticker badges and opens a floating Ticker Research pane on click` |
| 2 | `OnboardingWizard` | imports a broker portfolio before moving to Cloud; defers Back after broker persistence begins until the commit completes |
| 2 | `AiScreenerPane` | opens the inline prompt editor without using the dialog flow (~1.6 s); does not show a stale prompt-changed status while a refresh is active (~1.6 s) |
| 2 | `Shell` | updates the floating pane preview before mouse release; shows desktop window mode status and selected window title |
| 3 | Singles | `normalizePriceHistory > treats weekend-old listed history as stale instead of a live session`; `import boundaries > shared runtime code uses Gloom UI components instead of OpenTUI intrinsic tags`; `PortfolioListPane cash and margin UI > force-refreshes hidden stale cached snapshots when sorting by change percent` |

**A warning about the `PaneFooterBar` cluster specifically.** Recent uncommitted
work in this repo modified pane-footer behaviour (filtering unlabelled nodes out
of the `app://pane-footers` remote resource). Whether these five failures are
pre-existing or were introduced by that change **has not been determined**. Do
not assume either way — Step 1 tells you how to find out. The same caution
applies to the connection-source cluster, since that area was also touched.

### The 27 typecheck errors (`opentui` project)

By error code:

```
   6 error TS2345   (argument type not assignable)
   6 error TS2322   (type not assignable)
   4 error TS18048  (possibly undefined)
   4 error TS1355   (const assertion / literal type)
   3 error TS2352   (unsafe conversion)
   2 error TS2304   (cannot find name)
   1 error TS7006   (implicit any parameter)
   1 error TS2741   (missing property)
```

By file (top offenders — 12 of 27 sit in weather and alerts):

```
   4 src/plugins/builtin/weather/archive.ts
   4 src/plugins/builtin/alerts/weather-alert.ts
   4 src/plugins/builtin/alerts/index.tsx
   3 src/sources/nws-observations/load.ts
   2 src/plugins/builtin/substack/api/store.ts
   2 src/plugins/builtin/chart-composer/presets.ts
   2 src/components/layout/shell/index.tsx
   2 src/cli/pane-functions/discovery.ts
   1 src/remote/resources.ts
   1 src/remote/controller.ts
   1 src/plugins/builtin/ai/pi/agent-tools.ts
   1 src/components/layout/pane/footer/select-menu.tsx
```

`bun run typecheck` runs **five separate projects** and stops at the first
failure, so fixing `opentui` will expose the next project's errors. The other
four had 23-29 errors each at clean HEAD. Budget for all five:

```
"typecheck": "bun run typecheck:opentui && bun run typecheck:electrobun-bun && bun run typecheck:electrobun-view && bun run typecheck:scripts && bun run typecheck:cloud"
```

The two `TS2304` (cannot find name) errors are the most likely to be genuine
runtime bugs rather than annotation gaps — look at them first.

### The workflows

`.github/workflows/verify.yml` as it exists today:

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
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-bun
      - name: Test
        run: bun test
      - name: Build Electrobun view
        run: bun run desktop:view:build
      - name: Build core binary
        run: bun run build
      - name: Test global upgrade from 0.5.0
        run: bun run test:global-upgrade
```

`pr-checks.yml` also runs `bun run typecheck` and `bun test`.
**Do not consolidate the two workflows** — `plans/README.md` records that as
rejected finding TECH-03 ("CI minutes are not a bottleneck").

### Conventions

- TypeScript, 2-space indent, semicolons, `import type` for type-only imports.
- Tests use `bun:test` (`describe` / `it` / `expect`).
- AGENTS.md: *"Do not keep low-value tests just because they already exist or
  improve coverage counts."* and *"When touching a test file, trim nearby
  low-value tests if the cleanup is clear and low-risk."* This licenses deleting
  a genuinely worthless failing test — but see the STOP conditions, because
  deleting a test that documents real broken behaviour is the failure mode this
  plan must avoid.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Full tests | `bun test` | `0 fail` |
| One file | `bun test <path>` | all pass |
| One test by name | `bun test -t "<substring>"` | passes |
| Typecheck all | `bun run typecheck` | exit 0 |
| Typecheck one project | `bun run typecheck:opentui` | exit 0 (repeat for the other four) |
| Count type errors | `bun run typecheck:opentui 2>&1 \| grep -cE 'error TS[0-9]+'` | `0` |
| Clean-HEAD comparison | see Step 1 | — |

## Scope

**In scope**: the failing test files and the source files they cover; the files
listed in the typecheck table; `bunfig.toml` and `src/test-support/` if test
isolation still needs work.

**Out of scope** (do NOT touch):
- `.github/workflows/verify.yml` and `pr-checks.yml` — they are already correct.
  This plan makes the code pass the existing gates; it does not change the gates.
  Do **not** add `continue-on-error`, do **not** narrow the test command, and do
  **not** consolidate the two workflows (rejected TECH-03).
- `knip` configuration — removing `--no-exit-code` would surface ~135
  pre-existing dead-code findings. That is rejected finding TECH-04. Leave it.
- The i18n audit backlog (~93 untranslated referenced keys per locale). Not part
  of the CI gates. Leave it.
- New features, refactors, or drive-by improvements. Every change in this plan
  must be traceable to a specific failing test or type error.
- The behavioural fixes owned by other plans: `066` (watchlist quotes), `067`
  (broker credentials), `068` (data-dir isolation), `069` (remote redaction),
  `070` (pane contracts). If a failing test belongs to one of those areas,
  coordinate rather than fixing it twice.

## Git workflow

- Branch: `advisor/072-ci-baseline-repair`
- Conventional commits, matching the repo. Real examples from `git log`:
  `fix(chat): keep DMs when the public channel catalog refreshes`,
  `feat(cftc): stacked DCM-products-by-exchange chart`.
- **Commit per cluster**, not one giant commit. Each commit message should name
  the cluster and the count it fixes, e.g.
  `test(footer): restore PaneFooterBar registration expectations (5 failures)`.
  This keeps the diff reviewable and lets a bad fix be reverted alone.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Establish and attribute the baseline before changing anything

Record the current state, then determine for each cluster whether it fails at
clean HEAD too. This attribution is the difference between fixing a bug and
"fixing" a test that was correctly reporting one.

```sh
# 1. Record current counts.
bun test 2>&1 | tail -5 > /tmp/072-baseline-tests.txt
bun run typecheck 2>&1 | tail -30 > /tmp/072-baseline-typecheck.txt

# 2. Compare against clean HEAD in a DETACHED worktree.
#    A worktree leaves your working tree untouched — do NOT use git stash,
#    and do NOT check out a different branch in place. There may be a large
#    amount of uncommitted work here that must not be disturbed.
git worktree add /tmp/gloom-base-072 09e9b9a3
cd /tmp/gloom-base-072 && bun install && bun test 2>&1 | tail -40
```

Compare the failing-test lists. For each cluster, label it **pre-existing** (also
fails at `09e9b9a3`) or **introduced** (passes at `09e9b9a3`).

Pay particular attention to the `PaneFooterBar` and connection-source clusters —
both areas were recently modified, and an *introduced* failure means the product
code is wrong and the test is right.

Clean up when finished with the comparison:
`git worktree remove /tmp/gloom-base-072`.

**Verify**: you have a written table of cluster → pre-existing/introduced. Do not
proceed without it.

### Step 2: Confirm test isolation is in place

Check whether the pollution fixes described in "Current state" are present:

```sh
cat bunfig.toml                      # expect a [test] preload entry
ls src/test-support/setup.ts         # expect it to exist
grep -rln "mock.module" src/ | head  # then check each has an afterAll restore
```

If `bunfig.toml`'s preload or `src/test-support/setup.ts` is missing, restore
that mechanism first — it is worth ~67 failures on its own and every later step
is measured against a moving target without it.

For each file calling `mock.module()`, confirm it captures the real namespace via
`await import()` and reinstalls it in `afterAll`. Copy the pattern from
`src/remote/controller.test.ts`.

**Known exception — do not "fix" this one:** applying the namespace-restore
pattern to `src/renderers/electrobun/view/notes-files.test.ts` was attempted and
**broke it**, because the electrobun browser API it mocks requires `window` to
exist at restore time. Leave that file's mocking as it is. If you believe it must
change, that is a STOP condition.

**Verify**: `bun test 2>&1 | tail -3` → failure count at or below your Step 1
baseline.

### Step 3: Fix the test clusters, largest first

Work one cluster at a time, in descending size: `PaneFooterBar` (5), theme/pane
selectors (4), connection sources (3), ticker badges (3), then the pairs, then
the singles.

For each cluster:
1. Run just that cluster (`bun test <path>` or `bun test -t "<name>"`).
2. Read the failure output and decide which side is wrong — the test or the
   product code. Use the Step 1 attribution: an *introduced* failure usually
   means the product code regressed and the test is correct.
3. Fix the wrong side. Prefer fixing product code over relaxing an assertion.
4. Re-run the cluster, then re-run the full suite to confirm you did not trade
   one failure for another.
5. Commit that cluster alone.

Note the two `AiScreenerPane` tests take ~1.6 s each, which suggests they are
waiting on a timeout rather than failing fast — likely an await that never
settles. Look for a missing flush or an unresolved promise before assuming the
assertion is wrong.

For the `import boundaries` failure (`shared runtime code uses Gloom UI
components instead of OpenTUI intrinsic tags`): this is an **architectural guard**
test. Almost certainly some shared file now uses a raw OpenTUI intrinsic tag
where a Gloom UI component is required. Fix the offending import; do **not**
add an exemption to the boundary test. AGENTS.md is explicit: *"Always prefer
shared UI components and plugin APIs before rolling your own."*

**Verify** after each cluster: `bun test 2>&1 | tail -3` → failure count strictly
decreased. At the end of the step: `bun test` → `0 fail`.

### Step 4: Clear the typecheck errors, project by project

Fix `typecheck:opentui` first, then re-run `bun run typecheck` to reveal the next
project, and repeat through all five.

Start with the two `TS2304` (cannot find name) errors — a missing name is more
likely to be a real bug than a missing annotation. Then take the weather/alerts
cluster (12 of 27 errors across three files), since a single shared type fix
there will likely clear several errors at once.

Guidance:
- `TS18048` (possibly undefined) — add a real guard, do not add `!`. This repo
  has `noUncheckedIndexedAccess` enabled and `plans/README.md` records that
  non-null assertions were deliberately *not* blessed as the answer.
- `TS2352` (unsafe conversion) — do not silence with `as unknown as T`. Fix the
  type or narrow properly.
- Never add `// @ts-ignore` or `// @ts-expect-error` to reach zero. If an error
  genuinely cannot be fixed without a design change, STOP and report it.
- Never widen a type to `any`.

**Verify** per project: `bun run typecheck:opentui 2>&1 | grep -cE 'error TS[0-9]+'`
→ `0`. Finally: `bun run typecheck` → exit 0.

### Step 5: Prove the suite is stable, not just passing

A suite that passes once but has order-dependent tests is not a baseline. The
24-vs-21 discrepancy noted in "Current state" says at least one test is
order- or timing-sensitive.

Run the full suite three times and confirm `0 fail` every time:

```sh
for i in 1 2 3; do bun test 2>&1 | tail -3; done
```

If a test fails intermittently, fix the nondeterminism (an unawaited promise, a
real timer, a shared global, a date-dependent assertion). Do not paper over it
with a retry. If a test is nondeterministic *and* low value, AGENTS.md permits
deleting it — say so explicitly in your report with the reasoning.

**Verify**: three consecutive `bun test` runs report `0 fail`.

### Step 6: Confirm the full CI job passes, not just the two commands

`verify.yml` runs more than typecheck and tests. Run the rest locally so CI does
not fail on a step this plan never checked:

```sh
bun run desktop:view:build
bun run build
bun run test:global-upgrade
```

If any of these was already broken before your change, treat it as
**pre-existing** and report it rather than expanding scope — but say so clearly,
because "CI is green" is false if these fail.

**Verify**: each command exits 0, or is documented as pre-existing-broken with
evidence from the clean-HEAD worktree.

### Step 7: Hand off to the invariant gate

`plans/071-qa-invariant-layer.md` ships `.github/workflows/qa-invariants.yml`
with `continue-on-error: true` precisely because CI was red. Once this plan is
DONE and 071 has landed, that check can be promoted to blocking.

Do **not** promote it in this PR. Note in your report that the promotion is now
unblocked, and update the 072 row in `plans/README.md` to DONE so whoever owns
071 can see it.

**Verify**: `plans/README.md` row for 072 updated.

## Test plan

This plan adds essentially no new tests — it makes existing ones pass. The one
exception: if Step 3 finds that an *introduced* product regression had no
covering test beyond the one that caught it, and the regression has a concrete
failure mode likely to return, add a focused test. Judge against AGENTS.md:
*"add or keep a test only when it protects behavior that is easy to break and
hard to catch in review."*

Verification is the whole-suite state: `bun test` → `0 fail`, three runs in a
row; `bun run typecheck` → exit 0.

## Done criteria

ALL must hold:

- [ ] `bun test` reports `0 fail` on three consecutive runs
- [ ] `bun run typecheck` exits 0 (all five projects)
- [ ] `bun run typecheck 2>&1 | grep -cE 'error TS[0-9]+'` → `0`
- [ ] `grep -rn "@ts-ignore\|@ts-expect-error" src/ | wc -l` is **not higher**
      than at Step 1 (record the starting number)
- [ ] `bun run desktop:view:build`, `bun run build`, and
      `bun run test:global-upgrade` each exit 0, or are documented as
      pre-existing failures with clean-HEAD evidence
- [ ] `git diff .github/workflows/` is **empty** — the gates were not weakened
- [ ] Every deleted or materially relaxed test is listed in the final report
      with a one-line justification
- [ ] `git worktree list` shows no leftover `/tmp/gloom-base-072`
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- A failing test turns out to document a **real product bug** whose fix belongs
  to another plan (066-070) or is larger than a test repair. Report it; do not
  fix the product behaviour under this plan's branch and do not delete the test
  to reach green.
- Reaching zero typecheck errors would require `@ts-ignore`, `as any`, widening a
  type to `any`, or a design change.
- You are tempted to change anything under `.github/workflows/`. The gates are
  correct; the code must meet them.
- The `notes-files.test.ts` mocking appears to need the namespace-restore
  pattern (a previous attempt broke it — see Step 2).
- The clean-HEAD worktree cannot be created, or `bun install` in it fails —
  without the comparison you cannot attribute failures, and guessing is how a
  correct test gets deleted.
- Any `git` operation you are about to run could touch the main working tree's
  uncommitted changes. There may be a large amount of uncommitted work. Never
  run `git stash`, `git checkout <branch>` in place, `git reset --hard`, or
  `git clean` in the main worktree.
- More than ~5 failures resist attribution as either pre-existing or introduced.

## Maintenance notes

- **What a reviewer should scrutinise**: the list of any deleted or relaxed
  tests, and every place an assertion was changed rather than product code. Those
  are where a real bug can be buried to reach green.
- **Keep the isolation mechanism.** The `bunfig.toml` preload plus
  `src/test-support/setup.ts` and the `mock.module()` restore pattern are load
  bearing for ~67 of the original failures. A future PR that removes the preload,
  or adds a `mock.module()` call without an `afterAll` restore, will silently
  reintroduce cross-file pollution. That is worth a note in `CONTRIBUTING.md`.
- **Known follow-up, deliberately out of scope**: `src/test-support/setup.ts`
  overwrites `requestAnimationFrame` / `cancelAnimationFrame` in `beforeEach`
  without preserving the previous values or clearing pending handles. It works
  today, but it can interact badly with fake timers and with renderers
  constructed in `beforeAll`. Scoping it properly (save and restore around each
  test) is a small standalone improvement.
- **Once green, the gates gain teeth.** Promoting `qa-invariants.yml` from
  advisory to blocking (plan 071) becomes possible, and so does reconsidering
  rejected finding TECH-04 (`knip --no-exit-code`) as its own cleanup effort.
