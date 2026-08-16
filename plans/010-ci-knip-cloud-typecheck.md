# Plan 010: Add knip and Cloudflare typecheck to CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- .github/workflows/verify.yml package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but Plan 011 — dead dependency removal — benefits from
  knip being in CI first)
- **Category**: dx
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

Two gaps in CI:
1. The `typecheck` script in `package.json` runs four typecheck projects but
   omits `typecheck:cloud`, leaving ~17KB of Cloudflare Worker code unchecked.
   Type errors in the Worker pass CI and only surface at deploy or runtime.
2. `knip.json` is fully configured for dead-code and unused-dependency detection
   but is never run in CI. Dead code and unused deps accumulate undetected.

## Current state

**`package.json`** — typecheck script (line 34):

```json
"typecheck": "bun run typecheck:opentui && bun run typecheck:electrobun-bun && bun run typecheck:electrobun-view && bun run typecheck:scripts",
```

The `typecheck:cloud` script exists (line 39) but is not included:

```json
"typecheck:cloud": "bun run cloud:types && tsc --project tsconfig.cloudflare.json",
```

**`.github/workflows/verify.yml`** — full content:

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

No knip step exists. The `knip.json` config file is ready with entry points
and project paths.

**Convention**: CI uses a single `verify.yml` with multiple jobs. Each job
checks out the repo and uses `.github/actions/setup-bun` for Bun installation.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Cloud TC  | `bun run typecheck:cloud` | exit 0, no errors  |
| Knip      | `bunx knip`              | exit 0, no issues   |

## Scope

**In scope** (the only files you should modify):
- `package.json` — add `typecheck:cloud` to the `typecheck` script
- `.github/workflows/verify.yml` — add knip job

**Out of scope** (do NOT touch):
- `knip.json` — already configured
- `tsconfig.cloudflare.json` — already configured
- Any source code — if `typecheck:cloud` or knip surfaces errors, fix them
  only if they're trivial (a missing type import). If they require significant
  changes, STOP and report.

## Git workflow

- Branch: `advisor/010-ci-knip-cloud-typecheck`
- Commit message: `Add knip and Cloudflare Worker typecheck to CI`

## Steps

### Step 1: Add typecheck:cloud to the typecheck script

In `package.json`, update the `typecheck` script:

```json
"typecheck": "bun run typecheck:opentui && bun run typecheck:electrobun-bun && bun run typecheck:electrobun-view && bun run typecheck:scripts && bun run typecheck:cloud",
```

**Verify**: `bun run typecheck:cloud` → exit 0, no errors

If `typecheck:cloud` fails with pre-existing errors, fix only trivial issues
(missing type imports, wrong type annotations). If errors are complex, STOP
and report them — the plan can be split into "fix cloud type errors" and
"add cloud typecheck to CI".

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Add knip job to CI

In `.github/workflows/verify.yml`, add a new job after `typecheck`:

```yaml
  knip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: ./.github/actions/setup-bun

      - name: Check for dead code and unused dependencies
        run: bunx knip
```

**Verify**: `bunx knip` → exit 0, no issues

If knip reports issues, they are pre-existing dead code/dependencies. Fix only
trivial ones (remove clearly unused imports/exports). For unused dependencies,
verify with `grep -rn "from \"<dep>\"" src/` before removing. If knip reports
many issues, STOP and report the count — the cleanup can be a separate plan
(Plan 011 handles the two known dead deps).

### Step 3: Verify CI YAML is valid

**Verify**: `cat .github/workflows/verify.yml | head -60` → YAML looks syntactically correct (proper indentation, job names are valid)

## Test plan

- No automated tests needed — CI configuration changes are validated by the CI
  run itself.
- If knip reports issues that were fixed, verify the fixes don't break the build.

## Done criteria

- [ ] `bun run typecheck` exits 0 (now includes cloud typecheck)
- [ ] `bunx knip` exits 0 (or only reports issues that are documented as known)
- [ ] `grep "typecheck:cloud" package.json` shows it in the `typecheck` script
- [ ] `grep "knip" .github/workflows/verify.yml` shows a knip job
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- `typecheck:cloud` fails with more than 3 non-trivial errors — the cloud
  typecheck should be split into a separate "fix cloud types" plan.
- `knip` reports more than 10 issues — the cleanup should be a separate plan
  (only the two known dead deps from Plan 011 should be fixed here if knip
  catches them).
- The `.github/actions/setup-bun` action doesn't exist — report so the knip
  job can use a standard Bun setup action instead.

## Maintenance notes

- When new entry points are added to the project (new renderer, new CLI
  command), update `knip.json` to include them or knip will flag their imports
  as unused.
- When new dependencies are added, knip will verify they're actually imported.
- A reviewer should check the first CI run after this change to confirm both
  new checks pass.
