# Plan 070: Remove navigation-key footer hints and add BYOK viewer command-bar shortcut

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- src/plugins/builtin/broker-manager/footer.ts src/plugins/builtin/account-management/ai-providers-tab.tsx src/plugins/builtin/plugin-market/pane.tsx src/plugins/builtin/byok/pane.tsx src/plugins/builtin/byok/index.tsx src/plugins/builtin/ai/screener/footer.ts src/plugins/builtin/shared/pane-footer.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `09e9b9a3`, 2026-08-29

## Why this matters

Two pane-contract violations need cleanup. First, five panes show `Esc`/`Enter`
footer hints — generic navigation keys that the AGENTS.md pane-footer rule
explicitly bans ("No fixed labels, row counts, or generic keyboard hints").
These keys are never actually bound through the footer-hint mechanism:
`usePaneFooterHintBindings` in `src/plugins/builtin/shared/pane-footer.ts`
only binds single-char keys (or `/`), so multi-char keys like `esc`/`enter`/
`Esc`/`Enter` are visual-only. The real keyboard handlers live in separate
`useShortcut` calls in each pane's keyboard module. Removing the hints is
safe and brings the footer in line with the contract. Second, the BYOK API
viewer pane (`byokViewerTemplate`) has no `shortcut` field, so it is invisible
to the command-bar assist inventory — users cannot discover or open it via
the command bar. Adding a `shortcut: { prefix: "API" }` makes it discoverable.

## Current state

> **CRITICAL BASELINE WARNING.** This repo's CI is currently RED on `main`. At
> clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29
> typecheck errors per sub-project** (`bun run typecheck` exits 2). These
> failures are **PRE-EXISTING and NOT caused by your change.** Do NOT attempt to
> fix them — that is `plans/072-ci-baseline-repair.md`'s job. Before you start,
> record your own baseline:
>
> ```sh
> bun test 2>&1 | tail -5
> bun run typecheck 2>&1 | tail -20
> ```
>
> Every `bun test` / `bun run typecheck` gate in this plan means "no worse than
> that baseline", **not** "exits 0". Note that five of the currently failing
> tests are in `PaneFooterBar` — the same area this plan touches. Check whether
> those five are already failing **before** you change anything, so you can tell
> your effect apart from the standing noise.

### Footer hint binding mechanism (critical architectural fact)

**`src/plugins/builtin/shared/pane-footer.ts`** — `usePaneFooterHintBindings`
uses `useShortcut` to bind keyboard events to footer hint `onPress` handlers.
The guard `isBindableHintKey` only accepts single-character keys (or `/`):

```ts
// isBindableHintKey rejects multi-char keys like "enter", "esc", "Enter", "Esc"
// Only single-char keys (and "/") are bound through the footer hint path.
```

This means footer hints with `key: "Esc"`, `key: "Enter"`, `key: "enter"`, or
`key: "esc"` are **visual-only** — their `onPress` is never called by a
keyboard event. The actual Esc/Enter keyboard handling lives in separate
`useShortcut` calls in each pane's keyboard module (verified per-site below).

### Defect A: Esc/Enter footer hints (10 hint objects across 5 files)

Each site below has a **separate `useShortcut` handler** that binds Esc/Enter
to the real action. Removing the footer hint objects will NOT break keyboard
handling.

#### Site 1: broker-manager

**`src/plugins/builtin/broker-manager/footer.ts`** — lines 37-38 (editing
hints):

```ts
if (editing) {
  return [
    { id: "save", key: "enter", label: "save", onPress: () => actionsRef.current.saveEdit().catch(() => {}) },
    { id: "cancel", key: "esc", label: "cancel", onPress: onCancelEdit },
  ];
}
```

**Separate keyboard handler**: `src/plugins/builtin/broker-manager/keyboard.ts`
line 46 — `useShortcut` handles `event.name === "escape"` (calls
`onCancelEdit()`) and `event.name === "enter"` (calls `saveEdit()`) when
editing, and `case "enter"` (calls `onOpenDetail()`) when not editing.

#### Site 2: account-management (AI providers tab)

**`src/plugins/builtin/account-management/ai-providers-tab.tsx`** — lines
373-374 (editing hints) and line 378 (non-editing Enter hint):

```ts
hints: editing
  ? [
      { id: "save-key", key: "Enter", label: "save", onPress: handleSaveKey },
      { id: "cancel-key", key: "Esc", label: "cancel", onPress: handleCancelKey },
    ]
  : [
      ...(canDownloadModel ? [{ id: "download-model", key: "m", label: "odel", onPress: () => { void handleDownloadModel(); } }] : []),
      ...(canActivate ? [{ id: "activate", key: "Enter", label: "activate", onPress: handleActivate }] : []),
      ...(canAddKey ? [{ id: "add-key", key: "k", label: "ey", onPress: handleAddKey }] : []),
      ...(canSignIn ? [{ id: "sign-in", key: "s", label: "ign in", onPress: () => { void handleSignIn(); } }] : []),
      ...(canRefresh ? [{ id: "refresh", key: "r", label: "efresh", onPress: () => { void handleRefresh(); } }] : []),
      ...(canDeleteKey ? [{ id: "delete-key", key: "d", label: "elete key", onPress: handleDeleteKey }] : []),
    ],
```

Hints to remove: `save-key` (key: "Enter"), `cancel-key` (key: "Esc"),
`activate` (key: "Enter"). Keep all single-char key hints (`m`, `k`, `s`,
`r`, `d`).

**Separate keyboard handler**: `src/plugins/builtin/account-management/ai-providers-tab.tsx`
line 386 — `useShortcut` handles `event.name === "escape"` (calls
`handleCancelKey()`) and `event.name === "enter"` (calls `handleSaveKey()`
when editing, `handleActivate()` or `handleDownloadModel()` when not
editing).

#### Site 3: plugin-market

**`src/plugins/builtin/plugin-market/pane.tsx`** — lines 443-444 (install
mode hints):

```ts
hints: installMode
  ? [
      { id: "install-submit", key: "Enter", label: "install", onPress: handleInstallForm, disabled: busy || !installRef.trim() },
      { id: "install-cancel", key: "Esc", label: "cancel", onPress: cancelInstall },
    ]
  : [
      paneRefreshHint(refresh, { disabled: busy }),
      paneSearchHint(focusSearch, { disabled: installMode }),
      { id: "toggle", key: "t", label: "oggle", onPress: toggleSelected, disabled: !canToggle || busy },
      // ... more single-char hints
    ],
```

Hints to remove: `install-submit` (key: "Enter"), `install-cancel`
(key: "Esc"). Keep all single-char key hints in the non-install-mode branch.

**Separate keyboard handler**: `src/plugins/builtin/plugin-market/pane.tsx`
line 347 — `useShortcut` handles `event.name === "escape"` (calls
`cancelInstall()`) and `event.name === "enter"` (calls `handleInstallForm()`)
when in install mode.

#### Site 4: byok

**`src/plugins/builtin/byok/pane.tsx`** — lines 422-423 (editing hints):

```ts
hints: editing
  ? [
      { id: "save", key: "Enter", label: "save", onPress: handleSave },
      { id: "cancel", key: "Esc", label: "cancel", onPress: handleCancel },
    ]
  : [
      { id: "add", key: "a", label: "dd", onPress: handleAdd },
      ...(selectedEntry ? [{ id: "edit", key: "e", label: "dit", onPress: handleEdit }] : []),
      ...(selectedEntry ? [{ id: "test", key: "t", label: "est", onPress: handleTest }] : []),
      ...(canOpen ? [{ id: "open", key: "o", label: "pen", onPress: handleOpen }] : []),
      ...(selectedEntry ? [{ id: "delete", key: "d", label: "elete", onPress: handleDelete }] : []),
    ],
```

Hints to remove: `save` (key: "Enter"), `cancel` (key: "Esc"). Keep all
single-char key hints.

**Separate keyboard handler**: `src/plugins/builtin/byok/pane.tsx` line 360 —
`useShortcut` handles `event.name === "escape"` (calls `handleCancel()`) and
`event.name === "enter"` (calls `handleSave()`) when editing.

#### Site 5: ai/screener

**`src/plugins/builtin/ai/screener/footer.ts`** — lines 62 and 71:

```ts
hints: editorState
  ? [
      { id: "save", key: "Ctrl+S", label: t("save"), onPress: onSaveEditor },  // KEEP — Ctrl+S is a real shortcut
      { id: "cancel-edit", key: "Esc", label: t("cancel"), onPress: onCloseEditor },  // REMOVE
    ]
  : isRunningActiveTab
    ? [
        { id: "stop", key: "Esc", label: t("stop"), onPress: onCancelRun },  // REMOVE
      ]
    : [
        { id: "new", key: "t", label: t("new"), onPress: onAddTab },
        { id: "refresh", key: "r", label: t("efresh"), onPress: onRefresh, disabled: !activeTab },
        { id: "edit", key: "e", label: t("dit"), onPress: onEdit, disabled: !activeTab },
      ],
```

Hints to remove: `cancel-edit` (key: "Esc"), `stop` (key: "Esc"). **Keep**
`save` (key: "Ctrl+S") — it is a real multi-key shortcut, not a generic
navigation key. Keep all single-char key hints.

After removing both Esc hints, the `editorState` branch has only `Ctrl+S`
and the `isRunningActiveTab` branch becomes empty. If a branch becomes
empty (`isRunningActiveTab` with only the `stop` hint removed), replace it
with an empty array `[]` or omit the branch so the ternary falls through to
the default hints.

**Separate keyboard handler**: `src/plugins/builtin/ai/screener/keyboard.ts`
line 39 — `useShortcut` handles `event.name === "escape"` (calls
`closeEditor()` when editor is open, `cancelRun()` when a run is active).

### Defect B: BYOK viewer template missing `shortcut` field

**`src/plugins/builtin/byok/index.tsx`** — `byokViewerTemplate` (lines
48-68):

```ts
const byokViewerTemplate: PaneTemplateDef = {
  id: BYOK_VIEWER_TEMPLATE_ID,
  paneId: BYOK_VIEWER_PANE_ID,
  label: "Custom API",
  description: "Open a tested custom API in a data viewer.",
  keywords: ["api", "custom", "byok", "json", "csv"],
  canCreate: (_context, options) => !!options?.arg?.trim(),
  createInstance: (_context, options) => {
    // ...
  },
};
```

No `shortcut` field. Compare with the sibling `byokPaneTemplate` (lines
30-38) which has one:

```ts
const byokPaneTemplate: PaneTemplateDef = {
  id: BYOK_PANE_TEMPLATE_ID,
  paneId: BYOK_PANE_ID,
  label: "API Keys",
  description: "Open the BYOK settings pane to manage API keys",
  keywords: ["byok", "api", "key", "keys", "secret", "credential", "settings"],
  shortcut: { prefix: "KEYS" },
  createInstance: () => ({
    placement: "floating",
    title: "API Keys",
  }),
};
```

The prefix `API` is free — it does not collide with any existing command-bar
prefix (verified by grepping all `prefix:` declarations in the codebase).
`KEYS` is taken by the BYOK settings pane.

### Repo conventions (from AGENTS.md)

- "Pane footers: Status that can change (loading, error, live/delayed, stale,
  auth) plus action hints only. No fixed labels, row counts, or generic
  keyboard hints."
- "Bind the hinted key. A footer hint with no handler is a bug."
- "New panes: Give every new pane an AI-visible command-bar shortcut and a
  description the assist inventory can use."
- Footer hint keys that are single characters (like `a`, `e`, `r`, `o`, `d`,
  `t`, `s`, `k`, `m`) ARE bound through `usePaneFooterHintBindings` and must
  be kept. Only multi-char navigation keys (`Esc`, `Enter`, `Ctrl+S`) are
  visual-only. `Ctrl+S` is kept because it is a real shortcut, not a generic
  navigation key.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | error count not higher than your recorded baseline (it will NOT exit 0 — see the baseline warning) |
| Tests     | `bun test`               | failure count not higher than your recorded baseline (it will NOT exit 0) |
| Grep Esc  | `grep -rn 'key: "Esc"\|key: "Enter"\|key: "esc"\|key: "enter"' src/plugins/builtin/` | no matches after cleanup |

## Scope

**In scope** (the only files you should modify):
- `src/plugins/builtin/broker-manager/footer.ts` — remove Esc/Enter hints
- `src/plugins/builtin/account-management/ai-providers-tab.tsx` — remove Esc/Enter hints
- `src/plugins/builtin/plugin-market/pane.tsx` — remove Esc/Enter hints
- `src/plugins/builtin/byok/pane.tsx` — remove Esc/Enter hints
- `src/plugins/builtin/ai/screener/footer.ts` — remove Esc hints
- `src/plugins/builtin/byok/index.tsx` — add `shortcut: { prefix: "API" }` to `byokViewerTemplate`

**Out of scope** (do NOT touch):
- `src/plugins/builtin/shared/pane-footer.ts` — the binding mechanism is
  correct as-is; it intentionally rejects multi-char keys. Do not change it.
- `src/components/layout/pane/footer/index.tsx` — footer rendering component.
- `src/components/ui/shortcut-hint.tsx` — visual-only `ShortcutHint` component.
- Any keyboard handler files (`keyboard.ts`) — they are the real bindings and
  must not be changed.
- The `Ctrl+S` hint in `ai/screener/footer.ts` — keep it; it is a real shortcut.

## Git workflow

- Branch: `advisor/070-pane-contract-cleanups`
- Commit message style: `refactor: <description>` or `fix: <description>`
  (conventional commits)
- One commit for all changes, or one per site — either is fine.

## Steps

### Step 1: Remove Esc/Enter hints from broker-manager footer

In `src/plugins/builtin/broker-manager/footer.ts`, the `editing` branch
(lines 37-38) returns two hints with `key: "enter"` and `key: "esc"`. Remove
both hint objects. The `editing` branch should return an empty array `[]`:

```ts
if (editing) {
  return [];
}
```

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

### Step 2: Remove Esc/Enter hints from account-management AI providers tab

In `src/plugins/builtin/account-management/ai-providers-tab.tsx`, the
`usePaneFooter` call (around line 371) has an `editing` branch with two
hints (`save-key` with `key: "Enter"`, `cancel-key` with `key: "Esc"`) and
a non-editing branch with an `activate` hint (`key: "Enter"`).

Remove the three Esc/Enter hint objects. The `editing` branch should become
an empty array. The non-editing branch should keep all single-char key hints
(`m`, `k`, `s`, `r`, `d`):

```ts
hints: editing
  ? []
  : [
      ...(canDownloadModel ? [{ id: "download-model", key: "m", label: "odel", onPress: () => { void handleDownloadModel(); } }] : []),
      ...(canAddKey ? [{ id: "add-key", key: "k", label: "ey", onPress: handleAddKey }] : []),
      ...(canSignIn ? [{ id: "sign-in", key: "s", label: "ign in", onPress: () => { void handleSignIn(); } }] : []),
      ...(canRefresh ? [{ id: "refresh", key: "r", label: "efresh", onPress: () => { void handleRefresh(); } }] : []),
      ...(canDeleteKey ? [{ id: "delete-key", key: "d", label: "elete key", onPress: handleDeleteKey }] : []),
    ],
```

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

### Step 3: Remove Esc/Enter hints from plugin-market pane

In `src/plugins/builtin/plugin-market/pane.tsx`, the `usePaneFooter` call
(around line 433) has an `installMode` branch with two hints
(`install-submit` with `key: "Enter"`, `install-cancel` with `key: "Esc"`).

Remove both hint objects. The `installMode` branch should become an empty
array:

```ts
hints: installMode
  ? []
  : [
      paneRefreshHint(refresh, { disabled: busy }),
      paneSearchHint(focusSearch, { disabled: installMode }),
      { id: "toggle", key: "t", label: "oggle", onPress: toggleSelected, disabled: !canToggle || busy },
      // ... keep all remaining single-char hints
    ],
```

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

### Step 4: Remove Esc/Enter hints from byok pane

In `src/plugins/builtin/byok/pane.tsx`, the `usePaneFooter` call (around
line 416) has an `editing` branch with two hints (`save` with `key: "Enter"`,
`cancel` with `key: "Esc"`).

Remove both hint objects. The `editing` branch should become an empty array:

```ts
hints: editing
  ? []
  : [
      { id: "add", key: "a", label: "dd", onPress: handleAdd },
      ...(selectedEntry ? [{ id: "edit", key: "e", label: "dit", onPress: handleEdit }] : []),
      ...(selectedEntry ? [{ id: "test", key: "t", label: "est", onPress: handleTest }] : []),
      ...(canOpen ? [{ id: "open", key: "o", label: "pen", onPress: handleOpen }] : []),
      ...(selectedEntry ? [{ id: "delete", key: "d", label: "elete", onPress: handleDelete }] : []),
    ],
```

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

### Step 5: Remove Esc hints from ai/screener footer

In `src/plugins/builtin/ai/screener/footer.ts`, remove two hint objects:
1. `cancel-edit` (key: "Esc") in the `editorState` branch — keep `save`
   (key: "Ctrl+S")
2. `stop` (key: "Esc") in the `isRunningActiveTab` branch

After removal, the `isRunningActiveTab` branch becomes empty. Restructure
the ternary so that `isRunningActiveTab` falls through to the default
hints (the `t`/`r`/`e` hints). The result should look like:

```ts
hints: editorState
  ? [
      { id: "save", key: "Ctrl+S", label: t("save"), onPress: onSaveEditor },
    ]
  : isRunningActiveTab
    ? []
    : [
        { id: "new", key: "t", label: t("new"), onPress: onAddTab },
        { id: "refresh", key: "r", label: t("efresh"), onPress: onRefresh, disabled: !activeTab },
        { id: "edit", key: "e", label: t("dit"), onPress: onEdit, disabled: !activeTab },
      ],
```

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

### Step 6: Add `shortcut` to BYOK viewer template

In `src/plugins/builtin/byok/index.tsx`, add `shortcut: { prefix: "API" }`
to `byokViewerTemplate` (around line 54, after `keywords`):

```ts
const byokViewerTemplate: PaneTemplateDef = {
  id: BYOK_VIEWER_TEMPLATE_ID,
  paneId: BYOK_VIEWER_PANE_ID,
  label: "Custom API",
  description: "Open a tested custom API in a data viewer.",
  keywords: ["api", "custom", "byok", "json", "csv"],
  shortcut: { prefix: "API" },
  canCreate: (_context, options) => !!options?.arg?.trim(),
  createInstance: (_context, options) => {
    // ... unchanged
  },
};
```

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

### Step 7: Full verification

**Verify**: `bun run typecheck` → error count not higher than your recorded baseline

**Verify**: `bun test` → failure count not higher than your recorded baseline

**Verify**: `grep -rn 'key: "Esc"\|key: "Enter"\|key: "esc"\|key: "enter"' src/plugins/builtin/` → no matches (all Esc/Enter footer hints removed)

**Verify**: `grep -n 'prefix: "API"' src/plugins/builtin/byok/index.tsx` → one match (the new shortcut)

**Verify**: `grep -n 'Ctrl+S' src/plugins/builtin/ai/screener/footer.ts` → one match (the Ctrl+S hint is preserved)

## Test plan

- No new automated tests. AGENTS.md is explicit that these are weak test
  targets: *"Weak test targets: static metadata, default props, simple
  pass-through wiring, copied UI text."* A test asserting the contents of a hint
  array or a template's `shortcut` field would be exactly that. Do not add one.
- **A tmux smoke test is required, not optional.** These changes are only
  observable when rendered, and the whole risk of this plan is silently
  unbinding a key. AGENTS.md: *"Use tmux to test terminal TUI changes"* and
  *"Always kill the tmux session when done."*

Run against a **throwaway data dir** so you never touch real user state:

```sh
mkdir -p /tmp/qa-070
tmux new-session -d -s qa-070 -x 200 -y 50 \
  "bun run src/cli/entry.ts --data-dir /tmp/qa-070"
sleep 10
tmux capture-pane -p -t qa-070 | head -40
```

For each of the five affected panes, confirm both halves of the change:

1. The footer no longer shows an `Esc` or `Enter` hint.
2. **The keys still work.** Send the key and confirm the pane responds:
   `tmux send-keys -t qa-070 Escape` and `tmux send-keys -t qa-070 Enter`, then
   `tmux capture-pane -p -t qa-070` to confirm the dialog cancelled or saved as
   before. This is the check that catches the one way this plan can break the
   app.

Then confirm the new shortcut: open the command bar, type the `API` prefix, and
confirm the BYOK viewer pane is offered and opens.

Always clean up, even if a step failed:

```sh
tmux kill-session -t qa-070
rm -rf /tmp/qa-070
```

If you cannot complete the tmux verification, say so explicitly in your report
rather than claiming verification you did not perform.

## Done criteria

- [ ] `bun run typecheck` error count is **not higher** than the baseline you
      recorded at the start (it will NOT exit 0 — baseline is 27-29 errors per
      sub-project; that is plan 072's problem, not yours)
- [ ] `bun test` failure count is **not higher** than the baseline you recorded
      at the start (baseline ~91; it will NOT exit 0)
- [ ] The tmux smoke test in the Test plan was performed, and
      `tmux ls` shows no leftover `qa-070` session
- [ ] `grep -rn 'key: "Esc"\|key: "Enter"\|key: "esc"\|key: "enter"' src/plugins/builtin/` returns no matches
- [ ] `grep -n 'prefix: "API"' src/plugins/builtin/byok/index.tsx` returns one match
- [ ] `grep -n 'Ctrl+S' src/plugins/builtin/ai/screener/footer.ts` returns one match (Ctrl+S hint preserved)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- Any of the 5 affected panes does NOT have a separate `useShortcut` handler
  for Esc/Enter — removing the footer hint would break the key binding. Verify
  by checking each keyboard handler file listed in "Current state" before
  removing hints. If a handler is missing, STOP.
- The prefix `API` is already taken by another pane — re-check with
  `grep -rn 'prefix: "API"' src/` before adding it. If it collides, pick an
  alternative like `APV` (API Viewer) and report the choice.
- A step's verification fails twice after a reasonable fix attempt.
- Removing hints causes a TypeScript error because the `hints` array type
  does not accept empty arrays — report so the plan can be adjusted.

## Maintenance notes

- When adding footer hints in the future, only use single-character keys (or
  `/`). Multi-char keys like `Esc`, `Enter`, `Ctrl+S` are never bound through
  `usePaneFooterHintBindings` — they are visual-only. If a multi-char
  shortcut like `Ctrl+S` is worth showing, ensure the real binding is in a
  `useShortcut` call and the hint is explicitly for discoverability, not
  for binding.
- The `API` prefix is now claimed by the BYOK viewer template. Future panes
  must choose a different prefix. Check existing prefixes with
  `grep -rn 'prefix:' src/` before assigning one.
- A reviewer should spot-check each affected pane in the running app to
  confirm Esc/Enter still work after the hints are removed. The keyboard
  handlers are separate and should be unaffected, but a quick smoke test
  is worthwhile.
- The `isRunningActiveTab` branch in `ai/screener/footer.ts` now shows no
  hints when a run is active. If a future change adds a stop button or
  status indicator to the footer, it should use the `info` section (for
  status) not the `hints` section (for action keys).
