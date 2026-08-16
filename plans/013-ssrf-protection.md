# Plan 013: Add SSRF protection to Cloudflare Worker http.fetch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/renderers/cloudflare/backend.ts src/renderers/electrobun/shared/http-fetch.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

The Cloudflare Worker's `http.fetch` RPC handler passes any non-`api.gloom.sh`
URL directly to `handleHttpFetch()`, which only validates the URL protocol
(`http:` or `https:`) with no host allowlist or internal-IP filtering. Any
authenticated hosted user can use the Worker as a proxy to fetch arbitrary
HTTP/HTTPS URLs, including cloud metadata services (e.g., `169.254.169.254`),
internal network resources, or any network-reachable endpoint. The response
body is returned to the caller, making this a read-capable SSRF.

Adding a host allowlist for known external API hosts (and blocking private IP
ranges) closes this gap while preserving the legitimate external API calls
the hosted client needs.

## Current state

**`src/renderers/cloudflare/backend.ts`** — `http.fetch` handler (lines 140-163):

```typescript
    case "http.fetch": {
      const url = typeof request.payload?.url === "string" ? request.payload.url : "";
      if (url.startsWith("https://api.gloom.sh/")) {
        // ... session-attached Gloom Cloud fetch ...
        return { status, statusText, headers, setCookie, body };
      }
      return handleHttpFetch(request.payload);
    }
```

Any URL not starting with `https://api.gloom.sh/` falls through to
`handleHttpFetch`.

**`src/renderers/electrobun/shared/http-fetch.ts`** — `handleHttpFetch` (lines 36-50):

```typescript
export async function handleHttpFetch(
  payload: SharedHttpFetchRequest,
): Promise<SharedHttpFetchResponse> {
  if (typeof payload.url !== "string") {
    throw new Error("http.fetch requires a URL.");
  }

  const url = new URL(payload.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported http.fetch protocol: ${url.protocol}`);
  }

  // ... fetch proceeds with no host validation ...
```

**What the hosted client legitimately fetches through `http.fetch`**:
To determine the allowlist, search for `http.fetch` calls in the hosted web
client code:

```
grep -rn "http.fetch\|httpFetch\|handleHttpFetch" src/renderers/web/ src/plugins/builtin/
```

Known external API hosts the hosted client uses (from recon):
- Yahoo Finance (`query1.finance.yahoo.com`, `query2.finance.yahoo.com`)
- SEC EDGAR (`efts.sec.gov`, `www.sec.gov`)
- RSS feeds (arbitrary URLs — this is the tricky one)
- Adjacent (`api.adjacent.press` or similar)
- YouTube (`www.youtube.com`)

**Convention**: The codebase uses runtime-agnostic modules (see the comment at
the top of `http-fetch.ts`). Validation logic should be in a shared location
that works in all JS runtimes.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck:cloud` | exit 0, no errors  |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- `src/renderers/cloudflare/backend.ts` — add allowlist check before `handleHttpFetch`
- `src/renderers/electrobun/shared/http-fetch.ts` — add private-IP/localhost blocking (defense-in-depth, applies to all runtimes)
- `src/renderers/cloudflare/backend.test.ts` (create if not exists) or add to existing test file

**Out of scope** (do NOT touch):
- The Gloom Cloud session-attached fetch path (the `api.gloom.sh` branch) — it's already restricted
- The local web client or Electrobun backend — they run on the user's machine and don't have the same SSRF risk
- RSS feed URL handling — RSS feeds use arbitrary URLs, but the allowlist approach needs to handle this (see Step 1)

## Git workflow

- Branch: `advisor/013-ssrf-protection`
- Commit message: `Add host allowlist and private-IP filtering to http.fetch`

## Steps

### Step 1: Define the host allowlist

Search the codebase for all external API hosts the hosted client fetches:

```
grep -rn "http.fetch\|httpFetch" src/renderers/web/ src/plugins/builtin/ | grep -v test
```

Build an allowlist of host patterns. For RSS feeds (which use arbitrary URLs),
consider one of these approaches:
1. **Allowlist known RSS hosts** — too restrictive, users can add custom feeds
2. **Allow all HTTPS URLs but block private IP ranges** — the most practical
   approach for RSS, and the primary SSRF protection
3. **Allowlist API hosts + allow RSS URLs that match a safe pattern** — complex

Recommended: Option 2 for the Cloudflare Worker (block private IPs + localhost,
allow all public HTTPS). This protects against the SSRF target (internal/metadata
services) while preserving RSS functionality. Add the known API hosts to a
separate explicit allowlist for non-RSS fetches.

**Verify**: Document the allowlist approach and the list of known API hosts.

### Step 2: Add private-IP and localhost filtering to handleHttpFetch

In `src/renderers/electrobun/shared/http-fetch.ts`, after the protocol check,
add IP/host filtering:

```typescript
  const url = new URL(payload.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported http.fetch protocol: ${url.protocol}`);
  }

  // Block private/internal hosts to prevent SSRF
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") || hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") || hostname.startsWith("172.19.") ||
    hostname.startsWith("172.20.") || hostname.startsWith("172.21.") ||
    hostname.startsWith("172.22.") || hostname.startsWith("172.23.") ||
    hostname.startsWith("172.24.") || hostname.startsWith("172.25.") ||
    hostname.startsWith("172.26.") || hostname.startsWith("172.27.") ||
    hostname.startsWith("172.28.") || hostname.startsWith("172.29.") ||
    hostname.startsWith("172.30.") || hostname.startsWith("172.31.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`Blocked: http.fetch to private/internal host ${hostname}`);
  }
```

Note: This is defense-in-depth. On the Cloudflare Worker, DNS resolution may
not map to private IPs the same way, but this blocks the obvious cases. The
`169.254.` range blocks cloud metadata services.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 3: Add allowlist check in Cloudflare backend

In `src/renderers/cloudflare/backend.ts`, before the `handleHttpFetch` call,
add a host allowlist check for the hosted context:

```typescript
      // After the api.gloom.sh check:
      const fetchUrl = new URL(url);
      const allowedHosts = [
        "query1.finance.yahoo.com",
        "query2.finance.yahoo.com",
        "efts.sec.gov",
        "www.sec.gov",
        "api.adjacent.press",
        "www.youtube.com",
        // Add others found in Step 1
      ];
      // Allow RSS feeds from any public HTTPS host (filtered by handleHttpFetch's
      // private-IP check). For non-RSS fetches, require an allowlisted host.
      // Determine whether the fetch is RSS by checking the calling context or
      // URL pattern. If uncertain, allow all public HTTPS (the private-IP filter
      // in handleHttpFetch is the primary protection).
      return handleHttpFetch(request.payload);
```

If implementing a strict allowlist, add the check:

```typescript
      if (!allowedHosts.includes(fetchUrl.hostname)) {
        throw new Error(`Blocked: http.fetch to unapproved host ${fetchUrl.hostname}`);
      }
```

Choose strict vs. permissive based on Step 1 findings. If RSS feeds make a
strict allowlist impractical, rely on the private-IP filter from Step 2.

**Verify**: `bun run typecheck:cloud` → exit 0, no errors

### Step 4: Write tests

Create or add to test file for the Cloudflare backend:

- `http.fetch` to `https://api.gloom.sh/...` → proceeds (session-attached)
- `http.fetch` to `https://query1.finance.yahoo.com/...` → proceeds (allowlisted)
- `http.fetch` to `http://169.254.169.254/...` → blocked (metadata service)
- `http.fetch` to `http://localhost:8080/...` → blocked (private host)
- `http.fetch` to `http://192.168.1.1/...` → blocked (private IP)
- `http.fetch` to `ftp://example.com/...` → blocked (protocol, existing behavior)

**Verify**: `bun test` → all pass

## Test plan

- Tests for http.fetch URL validation
- Cases: allowlisted host, api.gloom.sh, metadata IP, localhost, private IP,
  bad protocol
- Pattern: `src/remote/server.test.ts` for the test structure

## Done criteria

- [ ] `bun run typecheck:cloud` exits 0
- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0; new tests pass
- [ ] `grep "169.254" src/renderers/electrobun/shared/http-fetch.ts` returns a match (metadata IP blocked)
- [ ] `grep "localhost\|127.0.0.1" src/renderers/electrobun/shared/http-fetch.ts` returns matches (localhost blocked)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- RSS feeds require arbitrary URL support that makes a strict allowlist
  impossible — report so the approach can be adjusted (the private-IP filter
  is still valuable as defense-in-depth).
- The hosted client fetches from hosts not in the allowlist that are
  legitimate — report the hosts so they can be added.
- `handleHttpFetch` is used by the local web client or Electrobun in ways that
  would break with private-IP filtering (e.g., fetching from localhost for
  development) — report so the filtering can be made Worker-only.

## Maintenance notes

- When a new external API is added to the hosted client, its host must be added
  to the allowlist (if using strict mode) or will be automatically allowed (if
  using the private-IP filter approach).
- Cloudflare Workers may have different DNS resolution behavior — the private-IP
  filter is a best-effort defense. Consider also using Cloudflare's built-in
  SSRF protections if available.
- A reviewer should test that the hosted client can still fetch quotes, SEC
  filings, and RSS feeds after the change.
