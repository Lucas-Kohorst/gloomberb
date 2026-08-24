# Plan 051: Default app and share theme to Adjacent

> **Executor instructions**: Change defaults only. Do not delete Amber.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/theme/themes.ts src/types/config.ts src/renderers/share`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

User: default share theme should be Adjacent, not Amber. Adjacent theme
already exists (`feat/adjacent-theme-display`). Defaults are still amber
in `DEFAULT_THEME`, `createDefaultConfig().theme`, and share CSS tokens
hardcoded with a comment that they are Amber.

## Current state

```660:667:src/theme/themes.ts
export const DEFAULT_THEME = "amber";
  return themes[id] ?? themes[DEFAULT_THEME]!;
```

```721:721:src/types/config.ts
    theme: "amber",
```

```7:19:src/renderers/share/styles.css
 * Tokens are the normalized Amber defaults the web host applies at boot.
  --gloom-border-focused: #ff8800;
  --gloom-text: #ff8800;
```

Share renderer has no theme switch (`share-main.tsx`, `shell.tsx`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/theme src/renderers/share src/types` | pass (whatever exists) |

## Scope

**In scope**
- `src/theme/themes.ts`
- `src/types/config.ts` default theme
- `src/renderers/share/styles.css` (and any share theme map)
- tests that pin `"amber"` as the default

**Out of scope**
- Forcing existing saved user configs from amber → adjacent (saved theme
  wins). Only **new** defaults / unthemed share pages.
- Redesigning Adjacent tokens

## Git workflow

- Branch: `feat/default-adjacent-theme`
- Commit: `feat(theme): default app and share pages to Adjacent`

## Steps

### Step 1: `DEFAULT_THEME = "adjacent"`

Keep fallback `themes[id] ?? themes.adjacent`. Update
`createDefaultConfig().theme`.

**Verify**: grep tests/snapshots for `theme: "amber"` as **default** (not
as a named theme option). Update those.

### Step 2: Share CSS tokens from Adjacent

Copy Adjacent forest/cream tokens from `themes.ts` into share CSS, or
drive share styles from the same theme object if share already imports JS
tokens. Do not leave `#ff8800` as the share accent.

**Verify**: `styles.css` no longer claims Amber defaults; focused border
is Adjacent’s token not `#ff8800`.

## Test plan

- Config default theme assertion.
- Share CSS/token test if one exists (`article-view.test.ts` may pin colors
  — update expected).
- Weak tests of “default prop is adjacent” — one assertion is enough.

## Done criteria

- [ ] `DEFAULT_THEME === "adjacent"`
- [ ] New config theme is `adjacent`
- [ ] Share CSS is not amber orange
- [ ] `plans/README.md` row 051 → DONE

## STOP conditions

- Share page is meant to stay high-contrast amber for readability of
  snapshots — still switch to Adjacent unless contrast fails WCAG on the
  article view; if it fails, report with contrast pairs, do not silently
  keep amber.

## Maintenance notes

Existing users with `theme: "amber"` in synced config must stay amber.
