# Plan 009: Sanitize Cloudflare Worker error responses

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/renderers/cloudflare/backend.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

The Cloudflare Worker backend catches errors and returns `error.message`
directly in the JSON response. Internal error messages may include file paths,
internal service names, or stack-trace-adjacent details. Returning these to
clients leaks infrastructure information. The fix maps known error types to
safe user-facing messages and returns a generic message for unrecognized errors.

## Current state

**`src/renderers/cloudflare/backend.ts`** — error handling in the dispatch
function (lines 76-89):

```typescript
  try {
    const value = await dispatch(env, user, request, envelope as HostedBackendRequest);
    return Response.json({ ok: true, value: encodeRpcValue(value ?? null) });
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloud_backend_error",
      method: envelope.method,
      userId: user?.id ?? null,
      message: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Hosted request failed.",
    }, { status: 400 });
  }
```

The full error message is logged server-side (correct) but also returned to
the client (the problem).

**Convention**: The codebase uses structured `console.error` with `JSON.stringify`
for server-side logging. Match this pattern for the server-side log. For the
client response, return a safe generic message.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck:cloud` | exit 0, no errors  |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/renderers/cloudflare/backend.ts`

**Out of scope** (do NOT touch):
- The `dispatch` function itself — only the catch block changes
- Error handling in `worker.ts` (the 501 and auth error responses)
- Any client-side error display logic

## Git workflow

- Branch: `advisor/009-sanitize-error-responses`
- Commit message: `Sanitize Cloudflare Worker error responses to avoid leaking internal details`

## Steps

### Step 1: Replace raw error.message with safe messages

In the catch block, keep the server-side log as-is (it's useful for debugging)
but replace the client-facing error with a safe message:

```typescript
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloud_backend_error",
      method: envelope.method,
      userId: user?.id ?? null,
      message: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({
      ok: false,
      error: "Hosted request failed. Check server logs for details.",
    }, { status: 400 });
  }
```

If there are known error types that should produce specific user-facing messages
(e.g., "Authentication required." for auth errors), check whether those errors
are thrown with a specific class or message pattern. If so, add a mapping:

```typescript
    const clientMessage = error instanceof Error && error.message.includes("Authentication")
      ? "Authentication required."
      : "Hosted request failed. Check server logs for details.";
    return Response.json({
      ok: false,
      error: clientMessage,
    }, { status: 400 });
```

Only add the mapping if the error patterns are clear and stable. Otherwise, the
generic message is sufficient.

**Verify**: `bun run typecheck:cloud` → exit 0, no errors

### Step 2: Verify existing tests pass

**Verify**: `bun test` → all pass

## Test plan

- No new tests required — the change only affects error response content, not
  control flow. Existing tests verify the error handling path works.
- If a test asserts the specific error message returned to the client, update
  it to match the new safe message.

## Done criteria

- [ ] `bun run typecheck:cloud` exits 0 (or only has pre-existing errors)
- [ ] `bun test` exits 0 (no regressions)
- [ ] `grep "error.message" src/renderers/cloudflare/backend.ts` does NOT match within a `Response.json` call (only within `console.error`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- A test specifically asserts the raw error message is returned to the client —
  report the test so it can be updated.
- The `dispatch` function throws errors with user-facing messages that should
  be preserved (e.g., validation errors from API input) — report the specific
  error types so a safe mapping can be designed.

## Maintenance notes

- If the hosted backend starts throwing specific validation errors that users
  should see (e.g., "Invalid ticker symbol"), add a safe mapping for those
  specific cases rather than returning the generic message for everything.
- A reviewer should trigger a backend error (e.g., send a malformed RPC request)
  and verify the response contains the safe message, not internal details.
