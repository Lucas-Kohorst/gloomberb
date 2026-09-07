# Plan 069: Redact credentials from remote-control resource payloads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- src/remote/resources.ts src/remote/redact-config.ts src/remote/controller.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `09e9b9a3`, 2026-08-29

## Why this matters

The remote-control resource API currently returns raw app config, including
broker credentials/OAuth tokens and BYOK API keys, to legitimate local
token holders. The server is not internet-exposed: `src/remote/server.ts:21`
mints a random UUID bearer token and `:25-27` binds to `127.0.0.1` on
ephemeral port 0; `:79-90` rejects requests without the bearer token. The
real risk is disclosure into AI model context, run traces, CI logs, or
artifacts when an agent or QA harness reads a snapshot. Plan 071 builds such
a loop, so secrets should be redacted before it lands.

This is not the rejected `SECURITY-04 (AI remote-control no approval gate)`
finding recorded in `plans/README.md`. SECURITY-04 concerned approval gates
for actions; this plan redacts secret values from resource reads with no UX
change.

## Current state

**`src/remote/resources.ts:114-146`** — `app://snapshot` embeds raw
`state.config`, and `app://config` returns it directly:

```ts
if (resource === "app://snapshot") {
  return {
    rev: activeLayoutRev(state),
    app: {
      activePanel: state.activePanel,
      focusedPaneId: state.focusedPaneId,
      previousFocusedPaneId: state.previousFocusedPaneId,
      statusBarVisible: state.statusBarVisible,
      commandBarOpen: state.commandBarOpen,
      commandBarQuery: state.commandBarQuery,
      initialized: state.initialized,
    },
    config: state.config,
    panes: state.config.layout.instances.map((pane) => paneSnapshot(state, pane)),
    commandBar: commandBarSnapshot(state, uiNodes),
    ui: uiNodes,
    schema: remoteControlSchema(),
    help: REMOTE_AGENT_HELP,
  };
}
if (resource === "app://config") return state.config;
```

`state.config` contains credential material in
`config.brokerInstances[].config` (broker credentials and OAuth tokens) and
under `config.pluginConfig.application.byokApiKeys`, whose key constant is
`BYOK_API_KEYS_CONFIG_KEY = "byokApiKeys"` at
`src/plugins/builtin/byok/types.ts:75`. `rg -n "redact|sanitize" src/remote/`
currently finds no matches.

Consumers found by `rg -n "app://snapshot|app://config" src/` include
`src/remote/controller.ts`, `src/remote/controller.test.ts`, and AI host/tool
guidance. The existing snapshot test is
`src/remote/controller.test.ts:421`; no legitimate consumer was found that
needs raw credential values.

This repo's CI is currently RED on `main`. At clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29 typecheck errors per sub-project** (exit 2). These failures are PRE-EXISTING and are NOT caused by your change. Do NOT attempt to fix them — that is plan 072's job. Before you start, record your own baseline with `bun test 2>&1 | tail -5` and `bun run typecheck 2>&1 | tail -20`. Your done criteria is that you do not INCREASE these counts, not that they reach zero.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | runs 5 sub-projects: `typecheck:opentui`, `typecheck:electrobun-bun`, `typecheck:electrobun-view`, `typecheck:scripts`, `typecheck:cloud` |
| Tests | `bun test` | baseline warning above applies; do not increase failures |
| Target tests | `bun test src/remote/controller.test.ts` | all tests pass |
| Consumer search | `rg -n "app://snapshot|app://config" src/` | consumers are reviewed; no raw-secret requirement |

## Scope

**In scope** (the only files you should modify):
- `src/remote/resources.ts`
- `src/remote/redact-config.ts` (or one new redaction module under `src/remote/`)
- `src/remote/controller.test.ts` (or one new test file under `src/remote/`)

**Out of scope** (do NOT touch):
- `src/remote/server.ts` — binding and auth are already correct
- approval gates for actions; SECURITY-04 was rejected
- BYOK storage under `src/plugins/builtin/byok/`
- sync/snapshot push paths

## Git workflow

- Branch: `advisor/069-redact-credentials-in-remote-resources`
- Use conventional commits, matching examples such as `fix(chat): keep DMs when the public channel catalog refreshes`.
- Do NOT push or open a PR.

## Steps

### Step 1: Record baseline and inspect consumers

Run the drift check, baseline commands, and consumer search. Read
`src/remote/controller.ts` and the relevant test setup before changing the
resource shape.

**Verify**: the consumer search completes and no consumer is shown to require
raw broker or BYOK credential values.

### Step 2: Add an explicit redaction helper

Create a helper such as `redactConfigForRemote(config)` under `src/remote/`.
Return a deep-cloned config-shaped value. Preserve broker identity and
non-secret metadata, but replace every value in
`brokerInstances[].config` with `"[redacted]"` while preserving its keys and
presence. Replace the `byokApiKeys` entry under the application plugin config
with a shape-preserving redacted value that reveals configured presence but no
API key material. Prefer explicit allowlist/shape handling over a broad regex
over arbitrary objects; if a denylist is required, document that new secret
fields must be added.

**Verify**: `bun run typecheck` → all five sub-projects run; baseline errors do
not increase.

### Step 3: Route both config resources through redaction

Import the helper in `src/remote/resources.ts` and use it for both
`app://snapshot` and `app://config`. Do not change transport authentication,
patch behavior, sync persistence, or unrelated resource shapes. Ensure the
remote result is not an alias that can mutate live config.

**Verify**: `rg -n "config: state.config|return state.config" src/remote/resources.ts` →
no raw return remains for these two GET resource branches.

### Step 4: Add regression coverage

Extend the existing remote test structure or add a focused
`src/remote/*.test.ts`. Build a config containing a broker instance with
test-only credential sentinels and a `byokApiKeys` entry. Read both
`app://snapshot` and `app://config`; assert
`JSON.stringify(result).not.toContain(SENTINEL)` for each injected sentinel,
while asserting broker `id`, `brokerType`, `label`, and non-secret config
shape/presence remain available. Never use a real key value.

**Verify**: `bun test src/remote/controller.test.ts` (or the new focused
remote test path) → all tests pass.

### Step 5: Run final checks

Run the target test file and full typecheck, comparing failure counts to the
recorded baseline. Do not repair unrelated baseline failures.

**Verify**: target remote tests pass; `bun run typecheck` runs all five
sub-projects without increasing baseline errors.

## Test plan

- Add or extend one test file under `src/remote/`.
- Cover both `app://snapshot` and `app://config`, broker credential values,
  BYOK API-key values, redacted presence/shape, and non-secret identity fields.
- Use `bun:test` and the existing `src/remote/controller.test.ts` harness as
  the structural pattern.
- Verification: focused remote test command → all tests pass.

## Done criteria

- [ ] Both `app://snapshot` and `app://config` contain no injected credential sentinel values.
- [ ] Broker identity and redacted credential presence/shape remain available.
- [ ] BYOK API-key entry is redacted and raw keys remain local.
- [ ] `bun run typecheck` does not increase the recorded baseline errors.
- [ ] Focused remote tests pass.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row updated by the plan owner.

## STOP conditions

Stop and report back (do not improvise) if:

- A legitimate existing consumer requires a raw credential from
  `app://snapshot` or `app://config`.
- Any Current state excerpt does not match the live code.
- The redaction cannot preserve required non-secret shape without exposing
  secret values.
- Target tests fail twice after a reasonable fix attempt.
- Test/typecheck counts INCREASE above the baseline you recorded.

The baseline caveat is mandatory: This repo's CI is currently RED on `main`. At clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29 typecheck errors per sub-project** (exit 2). These failures are PRE-EXISTING and are NOT caused by your change. Do NOT attempt to fix them — that is plan 072's job. Before you start, record your own baseline with `bun test 2>&1 | tail -5` and `bun run typecheck 2>&1 | tail -20`. Your done criteria is that you do not INCREASE these counts, not that they reach zero.

## Maintenance notes

- Keep the redaction policy explicit and review new broker credential fields
  whenever `BrokerInstanceConfig.config` changes.
- If the implementation uses a denylist, every newly introduced secret field
  must be added before exposing the resource.
- Review snapshot/logging consumers whenever remote resource shape changes.
- Do not “fix” this by weakening localhost binding or adding an action
  approval gate; those are separate concerns and out of scope.
