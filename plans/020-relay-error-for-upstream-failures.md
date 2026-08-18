# Plan 020: Use relayError for non-OK upstream responses in proxyToGloomCloud

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b9d938f..HEAD -- src/renderers/cloudflare/worker.ts src/renderers/cloudflare/gloom-cloud.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b9d938f`, 2026-08-17

## Why this matters

`proxyToGloomCloud` passes upstream response bodies directly to the client, including error responses that may contain internal details (stack traces, internal hostnames). The `relayError` function was built specifically to sanitize these via `parseApiErrorMessage`, but it's dead code — exported but never called. Wiring it in is a one-line fix that prevents internal error details from leaking to the browser.

## Current state

`src/renderers/cloudflare/worker.ts` around line 193-196:

```typescript
// Current: passes upstream body through unconditionally
return new Response(upstream.body, {
  status: upstream.status,
  headers,
});
```

`src/renderers/cloudflare/gloom-cloud.ts:88-90`:

```typescript
export async function relayError(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  return Response.json({ error: parseApiErrorMessage(text) || "Gloom Cloud request failed." }, { status: upstream.status });
}
```

`relayError` is exported but has zero callers (confirmed by grep).

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck:cloud` | exit 0         |
| Tests     | `bun test`           | all pass            |

## Scope

**In scope**:
- `src/renderers/cloudflare/worker.ts`

**Out of scope**:
- `src/renderers/cloudflare/gloom-cloud.ts` — do not modify `relayError` itself
- `src/renderers/cloudflare/backend.ts` — separate error sanitization concern

## Steps

### Step 1: Add relayError import

Ensure `relayError` is imported from `./gloom-cloud` at the top of `worker.ts`. Check existing imports from that module and add `relayError` if not already present.

**Verify**: `bun run typecheck:cloud` → exit 0

### Step 2: Use relayError for non-OK responses

In `proxyToGloomCloud`, before the `return new Response(upstream.body, ...)` line, add:

```typescript
if (!upstream.ok) {
  return relayError(upstream);
}
```

This ensures error responses (4xx, 5xx) are sanitized through `parseApiErrorMessage` before reaching the client. Successful responses (2xx, 3xx) still pass through unchanged.

**Verify**: `bun run typecheck:cloud` → exit 0

### Step 3: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0
- [ ] `grep -n "relayError" src/renderers/cloudflare/worker.ts` shows the import and usage
- [ ] No files outside scope are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `relayError` has already been wired in (the code has drifted — check the drift check).
- `proxyToGloomCloud` has been refactored to use a different response pattern.

## Maintenance notes

- `relayError` consumes the response body via `.text()`, so it must be called before any other body consumption. The current code streams the body directly, so this changes error responses from streaming to buffered — acceptable for error bodies which are small.
