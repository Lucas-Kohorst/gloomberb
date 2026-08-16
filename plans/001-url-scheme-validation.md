# Plan 001: Validate URL scheme before opening external links

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/components/ui/external-link.tsx src/renderers/opentui/host.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

`openUrl()` and the OpenTUI host's `openExternal()` pass any string directly to
`Bun.spawn(["open", url])` (macOS), `["cmd", "/c", "start", "", url]` (Windows),
or `["xdg-open", url]` (Linux) with no scheme validation. These functions are
called from ~20 sites where URLs originate from external API responses (RSS
feeds, prediction markets, news, Substack). A `file://` URL from a compromised
feed could launch local applications on macOS, and on Windows `cmd /c start`
passes the URL through cmd's parser, creating a command-injection vector.
Restricting to `http:` and `https:` schemes eliminates this attack surface.

## Current state

**`src/components/ui/external-link.tsx`** — shared `openUrl` function used by
ExternalLink, ExternalLinkText, and many plugin panes. Current code (lines 6-24):

```typescript
export function openUrl(url: string) {
  if (!url.trim()) return;

  const browserWindow = (globalThis as { window?: { open?: ... } }).window;
  if (typeof browserWindow?.open === "function") {
    browserWindow.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (typeof Bun !== "undefined" && typeof Bun.spawn === "function") {
    const platform = typeof process !== "undefined" ? process.platform : "linux";
    const command = platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
    const child = Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"] });
    child.unref();
  }
}
```

**`src/renderers/opentui/host.tsx`** — the OpenTUI renderer host's
`openExternal` method (lines 98-107):

```typescript
async openExternal(url) {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  const proc = Bun.spawn(command, {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
},
```

Neither function validates the URL scheme before spawning.

**Convention**: Error handling in this codebase is minimal for UI utilities —
silently returning on invalid input is the norm (see `openUrl` already returns
early on empty strings). Match this pattern: if the scheme is invalid, return
early without throwing.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/components/ui/external-link.tsx`
- `src/renderers/opentui/host.tsx`
- `src/components/ui/external-link.test.ts` (create)

**Out of scope** (do NOT touch):
- Any caller of `openUrl` or `openExternal` — they already pass strings; the
  guard belongs at the execution site, not at every call site.
- The browser `window.open` path — browsers already enforce scheme restrictions.

## Git workflow

- Branch: `advisor/001-url-scheme-validation`
- Commit per logical unit; message style: short imperative, e.g. `Validate URL scheme before opening external links`

## Steps

### Step 1: Add scheme validation to `openUrl`

In `src/components/ui/external-link.tsx`, after the `if (!url.trim()) return;`
line and before the browser window path, add a scheme check:

```typescript
export function openUrl(url: string) {
  if (!url.trim()) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

  const browserWindow = ...
```

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Add scheme validation to `openExternal` in host.tsx

In `src/renderers/opentui/host.tsx`, inside the `openExternal` method, add the
same scheme check before constructing the command:

```typescript
async openExternal(url) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

  const command = process.platform === "darwin"
    ...
```

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 3: Write tests for `openUrl` scheme validation

Create `src/components/ui/external-link.test.ts` with tests for:
- `openUrl("https://example.com")` — should not throw (scheme allowed)
- `openUrl("http://example.com")` — should not throw (scheme allowed)
- `openUrl("file:///etc/passwd")` — should return early without spawning
- `openUrl("javascript:alert(1)")` — should return early without spawning
- `openUrl("")` — should return early (existing behavior)
- `openUrl("not-a-url")` — should return early (URL parse fails)

Use `bun:test` (the repo's test runner). Mock `Bun.spawn` to verify it is NOT
called for rejected schemes. Model after `src/components/input-search-bar.test.tsx`
for the test structure.

**Verify**: `bun test src/components/ui/external-link.test.ts` → all pass

## Test plan

- New test file: `src/components/ui/external-link.test.ts`
- Cases: https allowed, http allowed, file:// rejected, javascript: rejected,
  empty string rejected, malformed URL rejected
- Pattern: `src/components/input-search-bar.test.tsx`

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0; new tests for URL scheme validation exist and pass
- [ ] `grep -n "file://\|javascript:" src/components/ui/external-link.tsx` returns no matches in any spawning context
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- `Bun.spawn` cannot be mocked in the test environment — report and use an
  alternative verification approach (e.g., spy on the spawn call).
- You discover that `openUrl` or `openExternal` is intentionally used to open
  non-web URLs (e.g., `mailto:` or custom deep links).

## Maintenance notes

- If deep-link support (`gloomberb://`) is added later, the scheme allowlist
  must be extended — but only for the desktop/Electrobun path, not for URLs
  from external API responses.
- A reviewer should verify that no existing call site relies on opening
  `mailto:` or other non-web schemes through `openUrl`.
