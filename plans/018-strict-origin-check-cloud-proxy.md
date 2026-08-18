# Plan 018: Enforce strict Origin check on Gloom Cloud proxy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/renderers/cloudflare/worker.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

`proxyToGloomCloud` uses `isSameOrigin()` which returns `true` when the Origin header is absent. This means non-browser clients can POST to `/cloud/*` endpoints without an Origin header, bypassing CSRF protection. Three other endpoints in the same file (`handleShareRequest`, `handleConfigSnapshotRequest`, `handleByokProxyRequest`) already use the strict check that rejects absent Origin. This is an inconsistency that weakens security.

## Current state

`src/renderers/cloudflare/worker.ts`:

```typescript
// Line 150-152 — the weak check
function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

// Line 172 — proxyToGloomCloud uses the weak check
async function proxyToGloomCloud(request: Request, env: Env, url: URL): Promise<Response> {
  const token = readSessionCookie(request);
  if (!isSameOrigin(request, url)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  // ...
}
```

The strict pattern used by other endpoints (e.g., `handleShareRequest` at line 44):

```typescript
if (request.headers.get("Origin") !== url.origin) {
  return Response.json({ error: "Invalid origin" }, { status: 403 });
}
```

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck:cloud` | exit 0         |
| Tests     | `bun test`           | all pass            |

## Scope

**In scope**:
- `src/renderers/cloudflare/worker.ts`

**Out of scope**:
- `isSameOrigin` function itself (other callers may still use it — only change `proxyToGloomCloud`)
- Any other endpoint

## Steps

### Step 1: Replace weak check in proxyToGloomCloud

In `proxyToGloomCloud` (around line 172), replace:

```typescript
if (!isSameOrigin(request, url)) {
```

with:

```typescript
if (request.headers.get("Origin") !== url.origin) {
```

This matches the strict pattern used by `handleShareRequest`, `handleConfigSnapshotRequest`, and `handleByokProxyRequest`.

**Verify**: `bun run typecheck:cloud` → exit 0

### Step 2: Check if isSameOrigin is still used

Run `grep -n "isSameOrigin" src/renderers/cloudflare/worker.ts`. If no other callers remain, delete the function. If other callers exist, leave it.

**Verify**: `bun run typecheck:cloud` → exit 0

### Step 3: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `grep -n "isSameOrigin" src/renderers/cloudflare/worker.ts` shows no usage in `proxyToGloomCloud`
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `proxyToGloomCloud` has been refactored to use a different auth pattern since this plan was written.
- The strict check breaks legitimate hosted client requests (verify the hosted web client sends Origin headers — it should, since it's a browser fetch).

## Maintenance notes

- If `isSameOrigin` is used by other endpoints in the future, consider whether those also need the strict check. The pattern in this file is: strict for state-changing endpoints, weak was only used for the proxy.
