# Plan 067: Stop broker credential loss from snapshot merge and label-collision reuse

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- src/data/config/hosted-config-snapshot.ts src/utils/broker-instances.ts src/app/runtime/plugin-bindings.ts src/data/config/hosted-config-snapshot.test.ts src/utils/broker-instances.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `09e9b9a3`, 2026-08-29

## Why this matters

Broker profiles contain the credentials and OAuth tokens required to connect,
but the hosted snapshot merge currently chooses a config bag by key count.
A remote identity snapshot can therefore overwrite usable local credentials,
and re-adding two accounts with the same broker and label can replace one
account's config and portfolios with the other's. The fix must preserve local
credential material and only reuse an instance when the account identity is
actually the same; otherwise a suffixed profile is safer than silent data
loss.

## Current state

**`src/data/config/hosted-config-snapshot.ts`** — snapshot merge preserves a
local broker config only when the incoming config is empty or has fewer keys
(lines 296-316):

```ts
/**
 * Snapshots carry broker identity without credentials (`config` is stripped on
 * push, OAuth tokens stay on-device). Assigning them wholesale would either
 * clear every profile or blank the credentials that make them usable, so keep
 * the local bag whenever the snapshot has nothing to put in its place.
 */
function mergeBrokerInstancesFromSnapshot(
  local: AppConfig["brokerInstances"],
  incoming: AppConfig["brokerInstances"],
): AppConfig["brokerInstances"] {
  if (incoming.length === 0) return local;
  const localById = new Map(local.map((instance) => [instance.id, instance]));
  const merged = incoming.map((instance) => {
    const current = localById.get(instance.id);
    if (!current) return instance;
    const keepLocalConfig = Object.keys(instance.config).length === 0
      || Object.keys(current.config).length > Object.keys(instance.config).length;
    return { ...instance, config: keepLocalConfig ? current.config : instance.config };
  });
  const mergedIds = new Set(merged.map((instance) => instance.id));
  return [...merged, ...local.filter((instance) => !mergedIds.has(instance.id))];
}
```

`src/types/config.ts:15-23` defines `BrokerInstanceConfig` with identity
fields `id`, `brokerType`, and `label`, optional `connectionMode`, `enabled`,
and `lastSyncedAt`, plus the opaque `config` record. Snapshots are designed to
carry identity without credentials: `src/sync/core-contributors.ts` contains
the deliberate `sanitizeBrokerInstance` push path and is out of scope.

**`src/utils/broker-instances.ts`** — `findReusableBrokerInstance` derives
the unsuffixed id from broker type and label and returns that profile
(lines 13-27):

```ts
export function findReusableBrokerInstance(
  brokerInstances: BrokerInstanceConfig[],
  brokerType: string,
  label: string,
): BrokerInstanceConfig | undefined {
  const baseId = createBrokerInstanceId(brokerType, label, []);
  return brokerInstances.find((instance) => instance.id === baseId && instance.brokerType === brokerType);
}
```

**`src/app/runtime/plugin-bindings.ts:186-212`** — the creation callback
passes only `(brokerType, label, values)` and replaces the whole existing
instance when the label-derived profile is found:

```ts
pluginRegistry.createBrokerInstanceFn = async (brokerType, label, values) => {
  // Re-adding the same account must reuse its instance. Suffixing the id on a
  // collision forked a fresh profile and a fresh portfolio set every time,
  // leaving the previous ones stranded with their imported positions.
  const existing = findReusableBrokerInstance(state.config.brokerInstances, brokerType, label);
  const baseId = existing?.id ?? createBrokerInstanceId(brokerType, label, []);
  const instance: BrokerInstanceConfig = {
    id: baseId,
    brokerType,
    label,
    connectionMode: typeof values.connectionMode === "string" ? values.connectionMode : undefined,
    config: values,
    enabled: true,
  };
  const nextConfig = {
    ...state.config,
    brokerInstances: existing
      ? state.config.brokerInstances.map((entry) => (entry.id === baseId ? instance : entry))
      : [...state.config.brokerInstances, instance],
  };
  dispatch({ type: "SET_CONFIG", config: nextConfig });
  await saveConfigImmediately(nextConfig);
  pluginRegistry.events.emit("config:changed", { config: nextConfig });
  return instance;
};
```

The live `createBrokerInstance` interface in `src/types/plugin.ts:577` has no
separate account-id parameter; inspect broker-specific `values` at execution
time for a stable account identifier. If none is genuinely available, do not
invent one: do not reuse on a label collision and let
`createBrokerInstanceId` create a suffixed profile.

**Tests** — `src/data/config/hosted-config-snapshot.test.ts` already covers
empty incoming broker config preserving local credentials and the OAuth/BYOK
stripping behavior. `src/utils/broker-instances.test.ts` covers the current
same-label reuse characterization.

**The privacy guard you must not break** lives in
`src/sync/core-contributors.test.ts:393-396`, not in the snapshot test:

```ts
    expect(serialized).not.toContain("account-id");
    expect(serialized).not.toContain("broker-id");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("brokerContractId");
```

Read that test before you start. It asserts that a serialized sync payload
carries no broker account identity at all. A previous attempt at this area tried
to propagate `brokerInstanceId` through the sync payload and broke exactly this
test — so if your fix for Defect B needs an account identifier, it must stay
**local** and never enter a synced payload. Run
`bun test src/sync/core-contributors.test.ts` before and after your change and
confirm it still passes. If your approach requires changing those four
assertions, that is a STOP condition, not a test to update.

Related credential-stripping assertions to keep green:
`src/data/config/hosted-config-snapshot.test.ts:59,82-83` and
`src/sync/core-contributors.test.ts:51-55,80`.

**Conventions**: TypeScript uses 2-space indentation, semicolons, and
`import type`; tests use `bun:test` (`describe`/`test`/`expect`). Comments
should explain hidden constraints, not restate code. Honor the rule:
“BYOK keys stay local (`writeHostedByokKeys`); never put raw API keys in
synced snapshots.”

This repo's CI is currently RED on `main`. At clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29 typecheck errors per sub-project** (exit 2). These failures are PRE-EXISTING and are NOT caused by your change. Do NOT attempt to fix them — that is plan 072's job. Before you start, record your own baseline with `bun test 2>&1 | tail -5` and `bun run typecheck 2>&1 | tail -20`. Your done criteria is that you do not INCREASE these counts, not that they reach zero.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | runs 5 sub-projects: `typecheck:opentui`, `typecheck:electrobun-bun`, `typecheck:electrobun-view`, `typecheck:scripts`, `typecheck:cloud` |
| Tests | `bun test` | baseline warning above applies; do not increase failures |
| Single tests | `bun test <path>` | all tests in the path pass |
| Target tests | `bun test src/data/config/hosted-config-snapshot.test.ts src/utils/broker-instances.test.ts` | all tests pass |

## Scope

**In scope** (the only files you should modify):
- `src/data/config/hosted-config-snapshot.ts`
- `src/utils/broker-instances.ts`
- `src/app/runtime/plugin-bindings.ts` (only `createBrokerInstanceFn`)
- `src/data/config/hosted-config-snapshot.test.ts`
- `src/utils/broker-instances.test.ts`

**Out of scope** (do NOT touch):
- `src/sync/core-contributors.ts` — its `sanitizeBrokerInstance` deliberately strips config on push
- `src/data/config/store/normalize.ts`
- broker-manager UI
- any change that puts credentials into a synced snapshot

## Git workflow

- Branch: `advisor/067-broker-credential-merge-safety`
- Use conventional commits, matching examples such as `fix(chat): keep DMs when the public channel catalog refreshes`.
- Do NOT push or open a PR.

## Steps

### Step 1: Record the baseline and verify the live excerpts

Run the drift check, then record `bun test 2>&1 | tail -5` and
`bun run typecheck 2>&1 | tail -20`. Read the broker creation call sites and
broker-specific value shapes to determine whether a stable account identifier
is available at creation time.

**Verify**: the drift check and both baseline commands complete; the recorded
counts are the comparison point for all later verification.

### Step 2: Make snapshot merges credential-safe

In `mergeBrokerInstancesFromSnapshot`, retain the existing doc comment and
never select a config bag by counting keys. For an existing id, keep
`current.config` unconditionally and copy only the explicit non-secret
identity/metadata fields (`id`, `brokerType`, `label`, `connectionMode`,
`enabled`, and `lastSyncedAt`) from the incoming instance. Do not spread
incoming config into the result. Preserve local-only instances and the
empty-incoming behavior.

**Verify**: `bun test src/data/config/hosted-config-snapshot.test.ts` →
all tests pass and the existing stripping/privacy expectations remain intact.

### Step 3: Stop label collisions from overwriting accounts

Change reuse so a stable account identifier is compared when one is
available in the creation values and the existing instance. If no stable
identifier is available, return no reusable instance for a label collision,
so `createBrokerInstanceId` takes its suffix path. Preserve re-adding the same
account without forking when its stable identity can be proven. Update only
the creation callback as needed to pass that identity; never replace a
different account's config or portfolio ownership.

**Verify**: `bun test src/utils/broker-instances.test.ts` → all tests pass,
including distinct same-label accounts retaining separate configs.

### Step 4: Add focused regression tests

Add a hosted merge case where incoming has more config keys than local and
assert the local credential bag survives. Keep assertions based on test-only
sentinels and retain the existing OAuth/BYOK stripping checks. Add a broker
instance case with two distinct accounts sharing a label; assert they do not
collapse and neither config is lost. If no stable creation-time identifier
exists, stop and report instead of weakening this test into a label-only
heuristic.

**Verify**: `bun test src/data/config/hosted-config-snapshot.test.ts src/utils/broker-instances.test.ts` → all targeted tests pass.

### Step 5: Run final checks

Run the target tests and full typecheck. Compare test/typecheck failure counts
with the baseline; do not fix unrelated baseline failures.

**Verify**: `bun test src/data/config/hosted-config-snapshot.test.ts src/utils/broker-instances.test.ts` passes; `bun run typecheck` runs all five sub-projects and does not increase baseline errors.

## Test plan

- Extend `src/data/config/hosted-config-snapshot.test.ts` with the
  more-incoming-keys regression and preserve the existing snapshot secret
  stripping assertions.
- Extend `src/utils/broker-instances.test.ts` with two distinct same-label
  accounts and separate configs.
- Structural patterns: existing tests in those two files, using `bun:test`.
- Verification: `bun test src/data/config/hosted-config-snapshot.test.ts src/utils/broker-instances.test.ts` → all targeted tests pass.

## Done criteria

- [ ] Local broker config always survives merge when an incoming instance has the same id.
- [ ] Same-label, different-account creation never replaces an existing profile or its config.
- [ ] `bun test src/data/config/hosted-config-snapshot.test.ts src/utils/broker-instances.test.ts` passes.
- [ ] `bun test src/sync/core-contributors.test.ts` passes, with the four
      assertions at lines 393-396 unmodified (`git diff src/sync/core-contributors.test.ts`
      shows no change to them)
- [ ] `bun run typecheck` does not increase the recorded baseline errors.
- [ ] No credentials are added to synced snapshot payloads.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row updated by the plan owner.

## STOP conditions

Stop and report back (do not improvise) if:

- Any Current state excerpt does not match the live code.
- No stable account identifier is available at instance-creation time; report
  the available broker values and options rather than inventing an identity.
- A change would put credentials into a synced snapshot, or would require
  modifying the privacy assertions at `src/sync/core-contributors.test.ts:393-396`.
  Those four assertions are the guard, not an obstacle — if your approach needs
  them relaxed, the approach is wrong. Report instead.
- Defect B's fix appears to need an account identifier that is only obtainable
  from a synced payload (it must be local-only).
- Target tests fail twice after a reasonable fix attempt.
- Test/typecheck counts INCREASE above the baseline you recorded.

The baseline caveat is mandatory: This repo's CI is currently RED on `main`. At clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29 typecheck errors per sub-project** (exit 2). These failures are PRE-EXISTING and are NOT caused by your change. Do NOT attempt to fix them — that is plan 072's job. Before you start, record your own baseline with `bun test 2>&1 | tail -5` and `bun run typecheck 2>&1 | tail -20`. Your done criteria is that you do not INCREASE these counts, not that they reach zero.

## Maintenance notes

- Keep snapshot merge identity fields explicit; newly added broker fields must
  be classified as secret or non-secret before they are copied.
- Never use config key counts as evidence that a remote snapshot has safer or
  newer credentials.
- If broker adapters gain a stable account subject, pass it through the
  creation contract and test same-account reuse plus distinct-account forks.
- Do not alter the deliberate sync sanitization or local BYOK storage path.
