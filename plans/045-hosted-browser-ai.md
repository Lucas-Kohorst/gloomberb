# Plan 045: Run Chrome Prompt API as the hosted AI host

> **Executor instructions**: Follow this plan. Do not re-enable
> `capability.invoke` on the Cloudflare backend. Do not send BYOK keys to
> Gloom Cloud sync.
>
> **Drift check**: `git diff --stat 9016c08e..HEAD -- src/plugins/builtin/ai src/plugins/builtin/sec/summary-runner.ts src/plugins/builtin/sec/use-filing-summary.ts src/renderers/electrobun/view/web-main.tsx src/renderers/electrobun/view/ai-host.ts src/plugins/builtin/account-management/ai-providers.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9016c08e`, 2026-08-24
- **Status**: DONE

## Why this matters

Filings show:

`No AI provider is available. Connect an AI provider in AI settings to summarize filings.`

That string is thrown only when the **providers array is empty**
(`src/plugins/builtin/sec/summary-runner.ts:66-71`).

There is **no Gloom Cloud LLM**. AI is:

| id | Where | Key |
|---|---|---|
| `browser-builtin` | Chrome Prompt API / Gemini Nano (`LanguageModel`) | none |
| `ollama` | local HTTP | none |
| anthropic/openai/… | Pi (`@earendil-works/pi-ai`) | OAuth/BYOK file store |

Hosted `web-main.tsx:162` calls `installElectrobunAiHost()`, which RPCs
`capability.invoke` → worker **always throws** (`backend.ts` hosted
capabilities disabled) → catalog publishes `[]` → `detectProviders()` caches
that empty array (empty is truthy) → filings fail.

`createBrowserAiRunHost` in `src/plugins/builtin/ai/browser.ts:212-223`
**has no callers**. ACM can still list “Browser (on-device) ★” because it
builds rows from `AI_PROVIDER_IDS` + `browserAiState` independently.

Zero-config path the user asked for: Chrome on-device model, no API key.

**Product decision (2026-08-24): heavily incorporate Chrome local AI.** It
is not a filings-only fallback. On hosted web it should be the default run
host for Ask AI, command-bar assist, filing summaries, and the AI screener
whenever `LanguageModel` is available or downloadable. Do not require a
Pi/BYOK key for those surfaces. ACM “Download model” is the only setup
step. Desktop Electrobun keeps the Pi host; do not replace it.

## Current state

```203:223:src/plugins/builtin/ai/browser.ts
export const browserAiRuntimeProvider: AiRuntimeProvider = {
  providerId: "browser-builtin",
  label: "Browser (on-device)",
  ...
};
export function createBrowserAiRunHost(catalog: AiRuntimeCatalog): AiRunHost {
  return {
    getCatalog: async () => catalog,
    run: ({ prompt, messages, onChunk }) => createBrowserAiRunController({ prompt, messages, onChunk }),
  };
}
```

Detection is **only** `globalThis.LanguageModel` (not legacy `window.ai`).
Hosted-only listing: `providers.ts` includes browser when
`__GLOOM_CLOUD_HOSTED === true`.

Filings already use `outputMode: "plain"` — the only mode Chrome advertises.

Download requires a **user gesture** (ACM “Download model”).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun test src/plugins/builtin/ai src/plugins/builtin/sec/summary-runner.test.ts src/plugins/builtin/account-management/ai-providers.test.ts` | pass |

## Suggested executor toolkit

- Chrome Prompt API: `LanguageModel.availability()`, `LanguageModel.create()`,
  `session.prompt` / `promptStreaming`
- Do not use `window.ai` (retired origin trial)

## Scope

**In scope**
- `src/plugins/builtin/ai/browser.ts`
- `src/plugins/builtin/ai/runner.ts` / `use-runtime-providers.ts` / `providers.ts`
- `src/plugins/builtin/ai/index.tsx` setup race
- `src/renderers/electrobun/view/web-main.tsx` (hosted install)
- `src/renderers/electrobun/view/ai-host.ts` only if you compose hosts
- `src/plugins/builtin/sec/summary-runner.ts` / `use-filing-summary.ts` only if
  provider resolution still ignores `browser-builtin`
- tests listed above
- ACM copy if the empty-state still says “connect a provider” when Chrome is
  downloadable

**Out of scope**
- Implementing Pi in the browser
- Worker-side LLM
- Putting BYOK keys in cloud snapshots (`writeHostedByokKeys` stays local)
- Enabling `capability.invoke` on hosted
- Ollama through the worker proxy (SSRF blocked)

## Git workflow

- Branch: `feat/hosted-browser-ai`
- Commit: `feat(ai): run Chrome Prompt API on hosted without Pi RPC`

## Steps

### Step 1: Composite hosted host

On hosted boot (`web-main.tsx`), do **not** let a failed Pi RPC wipe providers.

Install a host that:

1. `getCatalog()` returns `browser-builtin` when `LanguageModel` exists,
   plus any already-detected local providers. Never replace the catalog with
   `[]` on RPC failure.
2. `run()` for `browser-builtin` → `createBrowserAiRunController`.
3. Other provider ids: keep current “not available in the hosted client”
   error (do not pretend Pi works).

`detectProviders()` must treat `[]` as “not yet detected”, not as a cached
empty catalog. Change the sentinel (`null` vs array).

**Verify**: unit test: after `publishCatalog({ providers: [] })`,
`detectProviders()` still includes browser when `LanguageModel` is mocked.

### Step 2: Status check must not RPC

`checkAiProviderStatus` for `browser-builtin` should use
`refreshBrowserAiState()` / `availability()`, not `configuredHost.checkStatus`
RPC.

**Verify**: `summary-runner.test.ts` — with a mocked available browser
provider, `summarizeFiling` does not throw “No AI provider is available”.

### Step 2b: Every hosted AI surface uses the browser host

Wire `browser-builtin` through:

- Filings (`summary-runner` / `use-filing-summary`)
- Ask AI detail tab (`ask-ai-detail-tab.tsx`)
- Command-bar assist (hosted `/assist/command` must not be the only path —
  if assist RPC is unavailable, run the browser model locally)
- AI screener pane empty state — same provider list, not “connect a key”

Default provider id on hosted: `browser-builtin` when availability is
`available` or `downloadable`.

**Verify**: grep `createBrowserAiRunHost` / `browser-builtin` from those
callers or from the shared host so they do not each invent a stub.

### Step 3: Filings UX when downloadable

If availability is `downloadable`, the filings empty state should say to
open AI settings and click **Download model** (user gesture), not “connect
an AI provider”. Keep the hard error only when no provider id exists at all.

**Verify**: string assertion in the existing summary/UI test. Do not add
low-value copy-only tests beyond this one.

### Step 4: Do not race-wipe

`ai/index.tsx` re-injects Chrome after `getBrowserAiState()`. Ensure
`installAiRunHost` cannot publish empty over it. One write path for catalog.

## Test plan

- `providers.ts`: empty catalog does not stick; hosted includes browser.
- `browser.ts`: host `run` calls prompt controller (mock `LanguageModel`).
- `summary-runner.test.ts`: providers `[browser-builtin ready]` succeeds
  status resolve; `[]` still throws the current error.
- Pattern: `src/plugins/builtin/ai/browser.test.ts`,
  `src/plugins/builtin/sec/summary-runner.test.ts`.

## Done criteria

- [x] `grep -n "createBrowserAiRunHost" src` has a caller outside `browser.ts`
- [x] Hosted boot does not `setDetectedProviders([])` on capability failure
- [x] `bun test src/plugins/builtin/ai src/plugins/builtin/sec/summary-runner.test.ts` passes
- [x] `plans/README.md` row 045 → DONE

## STOP conditions

- Prompt API shape changed (`LanguageModel` missing methods) — adapt to the
  current Chrome surface; do not add a cloud model “just to unblock”.
- Electrobun desktop also hits `installElectrobunAiHost` — **do not** replace
  the native Pi host on desktop. Gate on `isHostedWebClient()` /
  `__GLOOM_CLOUD_HOSTED`.

## Maintenance notes

Chrome Prompt API is Chrome-desktop-only, hardware gated (~22GB disk, GPU/RAM
checks already in `browser.ts`). Safari/Firefox users still need a key later
(browser-side Pi host) — that is a later plan, not this one.

User steps after this ships:

1. Open `https://terminal.kohor.st` in Chrome
2. Account Management → AI → Browser (on-device) → Download model
3. Summarize a filing
