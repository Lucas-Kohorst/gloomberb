# Plan 021: Require authentication for BYOK keys info endpoint

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

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

The `/api/byok/keys` endpoint returns which API service keys are configured on the worker (Adjacent, Hyperliquid, SEC EDGAR) without checking authentication. Any unauthenticated client can query which external services the worker integrates with. While key values aren't exposed, the integration surface is. Adding a session check matches the pattern used by other sensitive endpoints like `handleConfigSnapshotRequest`.

## Current state

`src/renderers/cloudflare/worker.ts:271-281`:

```typescript
function handleByokKeysRequest(request: Request, env: Env): Response {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const knownEnvVars = [
    "ADJACENT_API_KEY",
    "HYPERLIQUID_API_KEY",
    "SEC_EDGAR_EMAIL",
  ];
  // ... returns which env vars are set
}
```

No `fetchSessionUser` or `resolveSessionUser` call. Compare with `handleConfigSnapshotRequest` (around line 109) which does check authentication.

The session resolution pattern:

```typescript
// From other endpoints in the same file
const resolved = await resolveSessionUser(request, env);
if (!resolved.user) {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}
```

Note: `handleByokKeysRequest` is currently synchronous (`Response`), so adding an `await` will make it `async`. Check the caller to ensure it handles a `Promise<Response>`.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck:cloud` | exit 0         |
| Tests     | `bun test`           | all pass            |

## Scope

**In scope**:
- `src/renderers/cloudflare/worker.ts`

**Out of scope**:
- Any other endpoint
- The BYOK proxy endpoint (`handleByokProxyRequest`) — it already has auth

## Steps

### Step 1: Make handleByokKeysRequest async and add auth check

Change the function signature from `Response` to `async (...): Promise<Response>` and add the session check after the method check:

```typescript
async function handleByokKeysRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const resolved = await resolveSessionUser(request, env);
  if (!resolved.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const knownEnvVars = [
    "ADJACENT_API_KEY",
    "HYPERLIQUID_API_KEY",
    "SEC_EDGAR_EMAIL",
  ];
  // ... rest unchanged
}
```

Check the call site — it may need `await` if it wasn't already awaiting.

**Verify**: `bun run typecheck:cloud` → exit 0

### Step 2: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `grep -A5 "handleByokKeysRequest" src/renderers/cloudflare/worker.ts` shows `resolveSessionUser` call
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `handleByokKeysRequest` has already been made async or has auth added (drift).
- The call site doesn't handle `Promise<Response>` — check the router/dispatch in the same file.

## Maintenance notes

- If the BYOK keys endpoint is ever used by the desktop renderer (non-browser), it may need a different auth mechanism. Currently it's only called from the hosted web client.
