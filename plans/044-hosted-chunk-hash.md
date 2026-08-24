# Plan 044: Hash web-main.js and 404 missing JS chunks

> **Executor instructions**: Follow this plan step by step. Do not reintroduce
> `.br`/`.gz` siblings in `dist/web-client`.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/renderers/electrobun/view/build-assets.ts src/renderers/cloudflare/worker.ts wrangler.jsonc scripts/build-web-client.ts scripts/check-web-bundle.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24

## Why this matters

Hosted crash:

`TypeError: Failed to fetch dynamically imported module: https://terminal.kohor.st/chunk-j5zatwwh.js`
at `Lazy` / `Suspense`.

Bun `splitting: true` emits stable `/web-main.js` and content-hashed
`/chunk-<hash>.js`. After deploy, old chunks disappear. A cached `web-main.js`
still imports `chunk-j5zatwwh.js`. SPA fallback
(`not_found_handling: "single-page-application"`) then serves **index.html with
200**, and Chrome reports a dynamic import TypeError.

Share entry already hashes the filename for this exact class of bug
(`hashShareEntrypoint` in `build-assets.ts:122-135`). `web-main.js` never got
that treatment.

There is no service worker. Precompression double-gzip was fixed in v0.13.3
and must stay gone.

## Current state

```48:54:src/renderers/electrobun/view/build-assets.ts
  const { entrySrc, stylesheet } = await buildElectrobunViewBundle({
    ...
    splitting: true,
```

```62:65:src/renderers/electrobun/view/build-assets.ts
  // Nested routes (`/s/{id}`) serve this same document; relative `./web-main.js`
  // would resolve under `/s/` and the SPA fallback would return HTML instead of
  // the module.
```

```400:403:src/renderers/cloudflare/worker.ts
  headers.set(
    "cache-control",
    shareDocument ? "private, no-store" : "private, max-age=0, must-revalidate",
  );
```

Lazy split points: `ui-host.tsx` TradingView chart, `share-main.tsx` chart view.

`wrangler.jsonc` assets: `directory: ./dist/web-client`, SPA not_found,
`run_worker_first: true`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Bundle | `bun run web:check-bundle` | exit 0 |
| Worker tests | `bun test src/renderers/cloudflare/worker.test.ts` | pass |
| Build | `bun run cloud:build` | writes hashed entry under `dist/web-client` |

## Scope

**In scope**
- `src/renderers/electrobun/view/build-assets.ts`
- `scripts/build-web-client.ts` / `scripts/check-web-bundle.ts`
- `src/renderers/cloudflare/worker.ts` (+ tests)
- `src/shares/routes.ts` only if cache headers for JS live there

**Out of scope**
- Re-enabling build-time brotli/gzip
- Hashing every CSS file unless required
- Service worker

## Git workflow

- Branch: `fix/hosted-web-main-hash`
- Commit: `fix(web): hash web-main and 404 missing JS modules`

## Steps

### Step 1: Hash `web-main.js` like `share-main`

Reuse `hashShareEntrypoint` (rename to a shared `hashBuiltEntrypoint` if that
is smaller). `index.html` must reference `/web-main.<hash>.js` with a
**root-absolute** URL (nested `/s/{id}`).

**Verify**: after `bun run cloud:build`, `dist/web-client/index.html` contains
`web-main.` + hex + `.js`, and that file exists. No unhashed `web-main.js`
script src.

### Step 2: Cache split

- HTML: keep `private, no-store` or `max-age=0, must-revalidate`
- Hashed JS (`web-main.*.js`, `chunk-*.js`, hashed share entry):
  `public, max-age=31536000, immutable`

**Verify**: worker tests for Cache-Control by path.

### Step 3: Do not SPA-fallback JS/CSS/maps

Before `ASSETS.fetch` SPA fallback, if the request path ends in
`.js` / `.css` / `.map` and the asset is missing, return **404** with
`Content-Type: text/plain` (not HTML).

**Verify**: worker test: `GET /chunk-does-not-exist.js` → 404, body is not
`<!doctype`.

### Step 4: Bundle check

Extend `scripts/check-web-bundle.ts` to fail if `index.html` still points at
unhashed `/web-main.js`.

**Verify**: `bun run web:check-bundle`

## Test plan

- Worker: hashed vs html cache headers; JS 404 vs HTML 200 SPA.
- Build script unit if one exists; otherwise `web:check-bundle`.
- Do not add a Playwright test for this.

## Done criteria

- [ ] `index.html` references hashed `web-main.<hash>.js`
- [ ] Missing `chunk-*.js` returns 404 not HTML
- [ ] `bun run web:check-bundle` passes
- [ ] No `.br`/`.gz` written next to JS
- [ ] `plans/README.md` row 044 → DONE

## STOP conditions

- Bun `splitting` already hashes `web-main` after a version bump — then only
  do the 404 + cache split.
- Wrangler SPA fallback cannot be bypassed for `*.js` — report; do not disable
  SPA for the whole site.

## Maintenance notes

Deploy still replaces all chunks. Hashing the entry is what makes HTML pick
up new chunks. Keep one previous generation of chunks only if you later add
asset retention; not required for this plan.
