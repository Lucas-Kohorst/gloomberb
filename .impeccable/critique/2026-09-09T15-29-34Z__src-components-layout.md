---
target: layout chrome and plugin marketplace
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-09-09T15-29-34Z
slug: src-components-layout
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Quick-setting `color` was unused until this session; lightning still easy to miss |
| 2 | Match System / Real World | 3 | Marketplace Retry/Log in look like dim list copy, not actions |
| 3 | User Control and Freedom | 3 | Close/restore isolated by extra margin and a dummy spacer |
| 4 | Consistency and Standards | 2 | Three button geometries: 28px header icons, 18px WebButton pills, 1-cell action rows |
| 5 | Error Prevention | 2 | Plugin gallery Install sits flush against Uninstall |
| 6 | Recognition Rather Than Recall | 3 | Header icons have titles; no focus-visible on pane header buttons |
| 7 | Flexibility and Efficiency | 4 | Hover-reveal, j/k, footer hints, command-bar prefixes |
| 8 | Aesthetic and Minimalist Design | 2 | Dummy 16px spacer, two-space indents, trailing empty Text cells |
| 9 | Error Recovery | 3 | Catalog error exists; recovery CTAs are the weakest-styled controls |
| 10 | Help and Documentation | 3 | Footer hints exist; restore was missing from header button CSS |
| **Total** | | **28/40** | **Good** |

## Design Specificity Verdict

**LLM assessment**: Authored for Gloomberb, not interchangeable SaaS. Cell-grid terminal chrome, 28px native header, MiniWorkspace previews, command-bar badges. The *spacing system for buttons* is not authored — three treatments fight.

**Deterministic scan**: `detect.mjs --scope layout` on layout, marketplace, plugin-marketplace, button, desktop controls, styles.css → **0 findings**. Layout-scoped rules do not match TSX. Manual mechanical scan is the real evidence.

**Visual overlays**: No injectable localhost page (Electrobun desktop). No user-visible overlay.

## Overall Impression

The pane-as-terminal identity is strong. The eye hits header chrome constantly, and marketplace CTAs are the last thing you touch — both are where spacing is sloppy. Biggest opportunity: one header-button primitive and one 8px gap on gallery footers.

This session already vertically centered header icon buttons (UA padding + 18px line box on the icon wrapper, restore dash drawn at y=5). Remaining issues are cluster rhythm and marketplace CTA gaps.

## What's Working

1. 28px native header locked to the titlebar; OpenTUI stays on the cell grid.
2. Command-bar badges are a fixed 7-char column, not chips.
3. Marketplace structure (Installed / Local / Discover + preview) matches other dense panes.

## Priority Issues

### [P0] Plugin gallery footer: Install flush against Uninstall
- **Why it matters**: Adjacent primary and destructive, 18px-tall pills, no gap. Highest-cost misclick on the marketplace.
- **Fix**: 8px (1 cell) gap between every footer button, matching layout gallery. Destructive last. Give WebButton a desktop minHeight of 24 inside the 2-row footer.
- **Suggested command**: `$impeccable layout`

### [P1] Header controls are still two clusters
- **Why it matters**: Float/action live in one group; close/restore sit in a second wrapper with `marginLeft={1}`. Hidden actions leave a dummy `Box width={2}` (16px) that is not 28px, so the close button jumps.
- **Fix**: One sibling row, 2px gap, 28px reserved slot or no spacer. Same hover/focus CSS for float, action, close, restore, quick-setting.
- **Suggested command**: `$impeccable layout`

### [P1] MarketplaceActionRow is padded text, not a button
- **Why it matters**: Retry / Log in / Refresh are recovery. Two leading spaces, 18px hit, no paddingX. Plugin rows use paddingX={1}; layout rows use a pip and no paddingX.
- **Fix**: Same row template as EntryRow. Footer owns `[enter]`, not spaces.
- **Suggested command**: `$impeccable layout`

### [P2] Three radii / heights for “button”
- **Why it matters**: Header r=4 / 28px; WebButton r=6 / 18px / 8px inline; window controls padding 0 / 28px. Refresh in the preview title sits in a 1-cell row.
- **Fix**: Icon chrome 28×28 r=4. Text buttons minHeight 24, paddingInline 8, radius 4, gap 8.
- **Suggested command**: `$impeccable polish`

### [P2] Duplicate header padding sources
- **Why it matters**: `paddingInline: 8` in JSX and `padding-inline: 8px` in CSS; action CSS `padding-inline: 4px` vs inline `paddingInline: 6`.
- **Fix**: One token. CSS owns native chrome; drop the duplicate.
- **Suggested command**: `$impeccable distill`

## Persona Red Flags

**Alex (Power User)**: Jumping close position when the dummy spacer appears; Install/Uninstall adjacency; unused lightning color (partially fixed this session). Do not add a toolbar — fix gaps.

**Sam (Accessibility)**: WebButton is Box+onMouseDown, no role/tabIndex/Enter. MarketplaceActionRow 18px target. No :focus-visible on pane header buttons. Nested data-gloom-role on close wrapper and inner button.

## Minor Observations

- Trailing `<Text> </Text>` on gallery rows is leftover cell pad.
- Header paddingInline declared twice.
- Grip 18×18 vs controls 28 — intentional handle vs button, but 6px grip margin is another one-off.
- Layout gallery already spaces footer buttons with `<Box width={1} />`; plugin gallery does not.
- Refresh Catalog in the preview title duplicates `[r]`efresh in the footer.

## Questions to Consider

- If close needs extra margin to feel safe, is the icon language too weak rather than the gap too small?
- Why is Refresh Catalog in the preview title when the pane already has `[r]`?
- Should marketplace CTAs be footer hints only (`[i]nstall`) and the pills go away?
