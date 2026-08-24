# Plan 049: Case-insensitive list search; command bar `aapl` is a ticker

> **Executor instructions**: Use `fuzzyFilter` (`src/utils/fuzzy-search.ts`)
> for UI lists. Turn **on** `rootPlainTickerSearchArg`. Do not auto-Ask-AI a
> 1–5 letter ticker token.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/components/command-bar src/utils/fuzzy-search.ts src/plugins/builtin/screener src/plugins/builtin/news/wire/article-search.ts src/plugins/builtin/chat/content/new-dm-dialog.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (047 covers PM pane search)
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

User asked for case-insensitive search across articles, equities, screeners,
PM, etc. Most matchers already `toLowerCase()`; the real bugs are:

1. Command bar `"aapl"` does **not** search tickers.
   `rootPlainTickerSearchArg: null` in
   `src/components/command-bar/routes/root/runtime.ts:251`.
   `mergePlainRootTickerResults` exists and is unused. Assist auto-asks
   any query ≥ 3 chars (`assist/model.ts`), Ask AI is category priority
   -100 so it always leads. Screenshot: Ask AI, then
   `DES AAPL — Open security details for AAPL`, `QQ`, `G`.
2. Chat DM search is case-sensitive (`username.includes(query)`).
3. Screener is substring includes, not fuzzy.
4. ART tokenizes `[^a-z0-9]` so non-ASCII letters drop.

## Current state

```233:251:src/components/command-bar/routes/root/runtime.ts
  const rootTickerSearchArg = rootSecurityDescriptionArg;
  ...
    rootPlainTickerSearchArg: null,
```

```90:99:src/plugins/builtin/screener/pane.tsx
const q = searchQuery.toLowerCase();
return filtered.filter((r) => r.symbol.toLowerCase().includes(q) || ...
```

Assist: `shouldAutoAskAssist` length ≥ 3, no prefix.

Row view renders **label + trailing only**; assist puts the whole sentence
in `label` and `detail: ""`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/components/command-bar src/plugins/builtin/screener src/plugins/builtin/news/wire/article-search.ts src/tickers/search` | pass |

## Suggested executor toolkit

- Skills: `frontend-design` / `impeccable` / `better-writing` for labels
- `fuzzyFilter` already lowercases

## Scope

**In scope**
- `src/components/command-bar/routes/root/runtime.ts`
- `src/components/command-bar/routes/root/provider-search.ts`
- assist auto-ask gate (`assist/model.ts` / `assist/runtime.ts`)
- command result labels (assist + DES/QQ/G candidates)
- screener filter
- ART `article-search.ts` tokenizer
- chat `new-dm-dialog.tsx`
- tests

**Out of scope**
- PM pane search (047)
- Redesigning the whole command bar (visual polish is 055; this plan is
  **behavior**: ticker-first results)
- Changing ticker ranking algorithm except wiring it on

## Git workflow

- Branch: `fix/search-case-and-cmdbar-ticker`
- Commits: `fix(command-bar): search tickers on plain root queries`,
  `fix(search): case-insensitive fuzzy on screener and DMs`

## Steps

### Step 1: Plain root ticker search

Set `rootPlainTickerSearchArg` to `rootQuery` when
`parseRootShortcutIntent` is `none` and the query looks like a symbol or
name (non-empty). Keep DES-arg provider search as today.

**Verify**: command-bar test: query `aapl` includes an Exact Match / ticker
row **before** Ask AI. `AAPL` and `aapl` same rows.

### Step 2: Do not auto-ask ticker tokens

`shouldAutoAskAssist` false for `^[A-Za-z]{1,5}$` (and maybe `^[A-Za-z]{1,5}[.=]?[A-Za-z0-9]*$`
for `BRK.B`). User can still invoke Ask AI explicitly.

**Verify**: `aapl` does not enqueue `/assist/command` in tests.

### Step 3: Candidate labels

Assist/command rows: `label` = title (`Open security details`), `right` or
trailing = `DES` / shortcut. Do not echo the query in the title.

**Verify**: frame/test does not contain `DES AAPL — Open security details for AAPL`.

### Step 4: Shared list matching

- Screener: `fuzzyFilter` on symbol/name/sector.
- Chat DM: lowercase both sides (or fuzzyFilter).
- ART: split on `[^\p{L}\p{N}]+` with unicode flag, still case-insensitive.

**Verify**: screener `aple` vs `Apple` if fuzzy subsequence allows; at least
`AAPL` vs `aapl`. DM `Bob` vs `bob`. ART title with a non-ASCII letter still
matches.

## Test plan

- Command bar root `aapl` / `AAPL`.
- Assist not auto for 4-letter token.
- Screener case.
- Pattern: existing command-bar root tests under
  `src/components/command-bar`.

## Done criteria

- [ ] `rootPlainTickerSearchArg` is not hard-coded `null`
- [ ] `aapl` ticker row exists and is above Ask AI
- [ ] Chat DM compare is case-insensitive
- [ ] Tests above pass
- [ ] `plans/README.md` row 049 → DONE

## STOP conditions

- Re-enabling plain ticker search duplicates DES rows three times — then
  collapse DES/QQ/G under one security row (still this plan).
- Assist API requires auto-ask for analytics — gate only ticker-shaped
  tokens, keep auto-ask for sentences.

## Maintenance notes

Screenshot of DES/QQ/G grouping is finished in 055 if this plan only
reorders. Prefer doing label cleanup here because it is the same files.
