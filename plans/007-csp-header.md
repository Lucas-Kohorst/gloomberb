# Plan 007: Add Content-Security-Policy header to hosted web app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/renderers/cloudflare/worker.ts`
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

The Cloudflare Worker's `serveApp` function sets `cache-control`,
`referrer-policy`, `x-content-type-options`, and `x-frame-options` headers but
no `Content-Security-Policy`. The hosted HTML includes an inline `<script>`
block (bootstrap script containing the session token) and an inline `<style>`
block. Without CSP, any XSS vector — however unlikely in a React SPA — would
execute unrestricted. Adding a CSP header with `script-src 'self' 'unsafe-inline'`
(noting the inline bootstrap constraint) provides defense-in-depth.

## Current state

**`src/renderers/cloudflare/worker.ts`** — `serveApp` function (lines 93-100):

```typescript
async function serveApp(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, max-age=0, must-revalidate");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, headers });
}
```

The HTML template at `src/renderers/electrobun/view/build-assets.ts:127-137`
includes an inline `<script>` block with the session token and an inline
`<style>` block. This means a strict CSP without `'unsafe-inline'` for
`script-src` would break the app. A nonce-based policy would be better but
requires changes to the HTML template — out of scope for this plan.

**Convention**: Security headers are set inline in `serveApp`. No separate
header configuration module exists. Match the existing pattern.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck:cloud` | exit 0, no errors  |
| Cloud check | `bun run cloud:check`  | exit 0, dry-run passes |

## Scope

**In scope** (the only files you should modify):
- `src/renderers/cloudflare/worker.ts`

**Out of scope** (do NOT touch):
- `src/renderers/electrobun/view/build-assets.ts` — the HTML template with
  inline scripts. Migrating to nonce-based CSP is a follow-up.
- Any other header or security configuration.

## Git workflow

- Branch: `advisor/007-csp-header`
- Commit message: `Add Content-Security-Policy header to hosted web app`

## Steps

### Step 1: Add CSP header to serveApp

In `src/renderers/cloudflare/worker.ts`, inside `serveApp`, add a CSP header
after the existing headers:

```typescript
  headers.set("x-frame-options", "DENY");
  headers.set(
    "content-security-policy",
    "default-src 'self'; "
      + "script-src 'self' 'unsafe-inline'; "
      + "style-src 'self' 'unsafe-inline'; "
      + "img-src 'self' data: https:; "
      + "connect-src 'self' https://api.gloom.sh; "
      + "frame-ancestors 'none'; "
      + "base-uri 'self'; "
      + "form-action 'self'",
  );
```

Rationale for each directive:
- `default-src 'self'` — restrict all resource types to same origin by default
- `script-src 'self' 'unsafe-inline'` — allow inline bootstrap script (needed
  until nonce-based CSP is implemented)
- `style-src 'self' 'unsafe-inline'` — allow inline styles
- `img-src 'self' data: https:` — allow data URIs and HTTPS images (logos, charts)
- `connect-src 'self' https://api.gloom.sh` — restrict fetch/WebSocket to self
  and the Gloom Cloud API
- `frame-ancestors 'none'` — equivalent to x-frame-options DENY but CSP-native
- `base-uri 'self'` — prevent base tag injection
- `form-action 'self'` — prevent form submissions to external origins

**Verify**: `bun run typecheck:cloud` → exit 0, no errors

### Step 2: Verify cloud dry-run

**Verify**: `bun run cloud:check` → exit 0, dry-run deploy passes

If `typecheck:cloud` or `cloud:check` fail with pre-existing errors unrelated
to this change, note them and proceed — the CSP addition should not introduce
new errors.

## Test plan

- No automated test needed for a header addition. Manual verification:
  - `bun run cloud:dev` and inspect response headers in browser devtools
  - Confirm the app loads and functions normally (charts, data, navigation)
  - Check browser console for CSP violations

## Done criteria

- [ ] `bun run typecheck:cloud` exits 0 (or only has pre-existing errors)
- [ ] `bun run cloud:check` exits 0 (or only has pre-existing errors)
- [ ] `grep "content-security-policy" src/renderers/cloudflare/worker.ts` returns a match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- The CSP breaks a legitimate resource load (e.g., the app loads images or
  scripts from a CDN not covered by the policy) — report the specific resource
  and origin so the policy can be adjusted.
- `typecheck:cloud` or `cloud:check` don't exist as commands (check
  `package.json` scripts).

## Maintenance notes

- When the inline bootstrap script is migrated to a nonce-based approach,
  update `script-src` to `'self' 'nonce-<value>'` and remove `'unsafe-inline'`.
- If new external API endpoints are added (beyond `api.gloom.sh`), they must
  be added to `connect-src` or the hosted client's fetch calls will be blocked.
- If YouTube embeds (for TV) are used on the hosted client, `frame-src
  https://www.youtube.com` must be added.
