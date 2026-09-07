# Plan 066: Give each prediction-market resolution its own timeout and clean up its retry timer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 09e9b9a3..HEAD -- src/plugins/prediction-markets/watchlist-quotes.ts`
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

`src/plugins/prediction-markets/watchlist-quotes.ts` is the bridge that makes
Polymarket and Kalshi tickers in a watchlist show live odds instead of a frozen
number. It was written specifically to fix that bug. Three defects in it mean
the fix only works for watchlists with a handful of prediction markets:

1. A single 15-second deadline is shared by *all* markets and starts before the
   first one is fetched. Resolution is sequential, so on a watchlist with many
   markets the deadline expires partway through and **every remaining market
   resolves to `null`, never gets a WebSocket subscription, and stays frozen** —
   silently reproducing the original bug.
2. When resolution yields nothing, a 500 ms retry timer reschedules itself
   forever and its handle is never stored, so React's cleanup cannot cancel it.
   It keeps firing after the pane unmounts and can open a WebSocket against a
   torn-down coordinator.
3. The Kalshi poller starts a new pass every 10 seconds with no check that the
   previous pass finished, so a slow pass overlaps the next one and multiplies
   outbound requests against a rate-limited API.

After this plan, every market gets its own fetch budget, the retry timer is
bounded and cancellable, and the Kalshi poller cannot overlap itself.

## Current state

Only one file is in scope: `src/plugins/prediction-markets/watchlist-quotes.ts`
(347 lines) — the hook `usePredictionWatchlistQuotes` plus its two helpers
`resolvePolymarketSummaries` and `pollKalshiWatchlistQuotes`.

> **CRITICAL BASELINE WARNING.** This repo's CI is currently RED on `main`. At
> clean HEAD `09e9b9a3` the baseline is **91 failing tests** and **27-29
> typecheck errors per sub-project** (`bun run typecheck` exits 2). These
> failures are **PRE-EXISTING and NOT caused by your change.** Do NOT try to fix
> them — that is plan 072's job. Before you start, record your own baseline:
> `bun test 2>&1 | tail -5` and `bun run typecheck 2>&1 | tail -20`. Your done
> criteria is that you do not **increase** these counts, not that they reach zero.

The two timing constants, at lines 14-15:

```ts
const KALSHI_POLL_INTERVAL_MS = 10_000;
const POLYMARKET_RESOLVE_TIMEOUT_MS = 15_000;
```

### Defect 1 — one shared, absolute deadline (line 234)

```ts
async function resolvePolymarketSummaries(
  infos: PredictionTickerInfo[],
): Promise<Map<string, PredictionMarketSummary>> {
  const result = new Map<string, PredictionMarketSummary>();
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, POLYMARKET_RESOLVE_TIMEOUT_MS));

  for (const info of infos) {
    if (info.venue !== "polymarket") continue;
    const slug = extractPolymarketSlug(`https://polymarket.com/event/${info.marketId}`);
    const marketId = slug ?? info.marketId;
    try {
      const summary = await Promise.race([
        resolvePolymarketMarketById(marketId),
        timeout.then(() => null),
      ]);
      if (summary) {
        result.set(info.marketKey, summary);
        // Also store under the venue:marketId key
        result.set(`${info.venue}:${info.marketId}`, summary);
      }
    } catch {
      // Best-effort resolution; skip on failure.
    }
  }

  return result;
}
```

`timeout` is created **once, before the loop**, and the loop `await`s each
market **sequentially**. So the 15 s is a budget for the entire batch, not per
request, and it is already counting down before the first fetch starts. Once it
fires, `timeout.then(() => null)` resolves *immediately* for every subsequent
iteration, so `Promise.race` returns `null` every time. Those markets never make
it into `result`, which means no `yesTokenId`, which means no WebSocket
subscription, which means no live odds.

Note the timer is also never cleared, so it keeps a handle alive for up to 15 s
after the function returns.

### Defect 2 — self-rescheduling retry with no stored handle (lines 313-337)

```ts
  // Subscribe to Polymarket CLOB WS for watchlist markets
  useEffect(() => {
    if (!coordinator || polymarketInfos.length === 0) return;

    let unsubscribe: (() => void) | null = null;
    let resolved = false;

    // Wait for summaries to be resolved, then subscribe
    const checkAndSubscribe = () => {
      const summaries = summariesRef.current;
      if (summaries.size === 0 && !resolved) {
        // Retry after a short delay if summaries aren't ready yet
        setTimeout(checkAndSubscribe, 500);
        return;
      }
      resolved = true;
      priceTrackerRef.current = rollPriceTracker(priceTrackerRef.current);
      unsubscribe = subscribePolymarketWatchlistQuotes(
        polymarketInfos,
        summaries,
        coordinator,
        priceTrackerRef,
      );
    };

    checkAndSubscribe();

    return () => {
      unsubscribe?.();
    };
  }, [coordinator, polymarketKey]);
```

Two problems. The `setTimeout` return value is discarded, and the cleanup only
calls `unsubscribe?.()` — so a pending retry survives unmount and can call
`subscribePolymarketWatchlistQuotes` afterwards. And there is no attempt cap:
if resolution never populates `summariesRef` (which Defect 1 makes likely for
larger watchlists, and which is certain if every fetch fails), `summaries.size`
stays `0` forever and this reschedules itself **every 500 ms for the lifetime of
the process**.

This effect races the separate resolution effect above it (lines ~296-309),
which writes `summariesRef.current` when its promise settles. The polling is the
synchronisation mechanism; keep that structure unless you have a reason to
change it, but make it bounded and cancellable.

### Defect 3 — Kalshi poller has no in-flight guard (line 219)

```ts
  const poll = async () => {
    if (cancelled) return;
    for (const info of infos) {
      if (cancelled) return;
      try {
        const url = `${kalshiBase}/markets/${encodeURIComponent(info.marketId)}`;
        const record = await withConnectionRequest("kalshi", "watchlist-poll", () => fetchJson<any>(url));
        // ... parse yes_bid / yes_ask / last_price, buildQuote, coordinator.pushQuote ...
      } catch {
        // Best-effort poll; failures are silent.
      }
    }
  };

  void poll();
  const intervalId = setInterval(() => void poll(), KALSHI_POLL_INTERVAL_MS);
  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}
```

`poll` fetches each market **sequentially** and `setInterval` fires every
10 s regardless of whether the previous `poll` is still running. With enough
Kalshi markets, or one slow response, passes overlap and stack up. The
`cancelled` flag only handles teardown, not overlap.

### Conventions to match

- TypeScript, 2-space indent, semicolons, `import type` for type-only imports.
- Comments explain **why** (a hidden constraint or a non-obvious failure mode),
  never what the code does. The existing comments in this file that explain
  intent (for example the doc comment on `usePredictionWatchlistQuotes`
  describing that the bridge runs independently of PM pane focus) should be
  preserved.
- Tests use `bun:test`: `import { describe, it, expect } from "bun:test"`.
- AGENTS.md on test value: *"Be selective: add or keep a test only when it
  protects behavior that is easy to break and hard to catch in review. Good test
  targets: parser/math/state complexity, async/cache/persistence behavior,
  integration boundaries, and regressions with a concrete failure mode that
  could plausibly return."* The per-market-timeout regression qualifies. Do not
  add tests for trivial wiring.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all 5 projects) | `bun run typecheck` | Does not exceed the baseline you recorded. Runs `typecheck:opentui`, `typecheck:electrobun-bun`, `typecheck:electrobun-view`, `typecheck:scripts`, `typecheck:cloud`. |
| Full test suite | `bun test` | Failure count does not exceed your recorded baseline (~91) |
| This plan's tests | `bun test src/plugins/prediction-markets/watchlist-quotes.test.ts` | all pass |
| Existing PM tests | `bun test src/plugins/prediction-markets/` | no new failures vs baseline |

## Scope

**In scope** (the only files you should modify):
- `src/plugins/prediction-markets/watchlist-quotes.ts`
- `src/plugins/prediction-markets/watchlist-quotes.test.ts` (create — verify it
  does not already exist first with `ls src/plugins/prediction-markets/`)

**Out of scope** (do NOT touch, even though they look related):
- `src/market-data/coordinator/index.ts` — `pushQuote` already delegates to
  `applyStreamQuote`, which performs validation, a unit-mismatch guard, and an
  equivalence check. It is correct. Do not add validation here.
- `src/plugins/prediction-markets/services/polymarket/ws.ts` and
  `resolvePolymarketMarketById` — the transport and the resolver are not the
  bug; the bug is how this file budgets time around them.
- `src/plugins/builtin/portfolio-list/` — the mount site and its `enabled` flag
  are correct.
- `src/plugins/prediction-markets/rows.ts`, `columns.ts`, `metrics.ts` — grouping
  and formatting are a separate concern, recently fixed. Leave them alone.
- Do **not** change `POLYMARKET_RESOLVE_TIMEOUT_MS` to a larger batch-wide value
  as a shortcut. That trades one silent failure for a slower silent failure.

## Git workflow

- Branch: `advisor/066-watchlist-quote-deadline`
- Conventional commits, matching the repo's existing style. Real examples from
  `git log`: `fix(chat): keep DMs when the public channel catalog refreshes`,
  `feat(cftc): stacked DCM-products-by-exchange chart`. Suggested:
  `fix(prediction-markets): budget resolution timeout per market`.
- Commit per step.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Give each resolution its own timeout, and clear it

In `resolvePolymarketSummaries`, replace the single shared `timeout` promise with
a per-iteration deadline, and make sure the timer is cleared once the race
settles so no handle outlives the call.

Target shape — a small helper that races one promise against a fresh timer and
always clears it:

```ts
async function withResolveTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
```

Then call it per market inside the existing loop, keeping the existing
`try`/`catch` and both `result.set(...)` calls exactly as they are.

Rename the constant so the unit of the budget is unambiguous — it is now a
per-request budget, not a batch budget. Use
`POLYMARKET_RESOLVE_TIMEOUT_PER_MARKET_MS` and add a comment explaining **why**
it is per-market (a shared deadline silently starved later markets of their
`yesTokenId`). Consider whether 15 s per market is still the right value: with
sequential resolution, N markets can now take up to N×15 s worst case. If you
lower it, state the new value and the reasoning in your report. Do not
parallelise the loop in this step — see Step 4.

**Verify**: `grep -n "POLYMARKET_RESOLVE_TIMEOUT" src/plugins/prediction-markets/watchlist-quotes.ts`
→ no remaining reference to a single batch-wide `timeout` promise created outside
the loop; `bun run typecheck` → no increase over baseline.

### Step 2: Make the retry timer bounded and cancellable

In the subscribe effect, store the timer handle and clear it in the cleanup, and
cap the number of retries so a permanently empty `summariesRef` cannot spin
forever.

Target shape:

```ts
    let unsubscribe: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let attempts = 0;

    const checkAndSubscribe = () => {
      if (cancelled) return;
      const summaries = summariesRef.current;
      if (summaries.size === 0 && attempts < SUBSCRIBE_RETRY_LIMIT) {
        attempts += 1;
        retryTimer = setTimeout(checkAndSubscribe, SUBSCRIBE_RETRY_DELAY_MS);
        return;
      }
      priceTrackerRef.current = rollPriceTracker(priceTrackerRef.current);
      unsubscribe = subscribePolymarketWatchlistQuotes(
        polymarketInfos,
        summaries,
        coordinator,
        priceTrackerRef,
      );
    };

    checkAndSubscribe();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      unsubscribe?.();
    };
```

Add the two constants near the existing ones at the top of the file. Choose a
retry limit whose total wait comfortably covers a normal resolution: with a
500 ms delay, 20 attempts is 10 s. Note in a comment **why** there is a cap
(an unbounded self-rescheduling timer previously survived unmount).

Preserve the existing behaviour that subscribing with a non-empty `summaries`
map is the success path, and that giving up still calls
`subscribePolymarketWatchlistQuotes` once (markets without a summary simply have
no token to subscribe to). If you decide it is better to skip the final
subscribe entirely when `summaries.size === 0`, that is acceptable — but say so
explicitly in your report, because it changes behaviour.

The `resolved` boolean becomes redundant once `attempts` exists; remove it
rather than leaving a dead variable.

**Verify**: `bun run typecheck` → no increase over baseline. Then
`grep -n "setTimeout(checkAndSubscribe" src/plugins/prediction-markets/watchlist-quotes.ts`
→ the result is assigned to `retryTimer`, not discarded.

### Step 3: Add an in-flight guard to the Kalshi poller

In `pollKalshiWatchlistQuotes`, skip a tick if the previous pass has not
finished.

Target shape:

```ts
  let cancelled = false;
  let inFlight = false;

  const poll = async () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    try {
      for (const info of infos) {
        // ... existing body unchanged ...
      }
    } finally {
      inFlight = false;
    }
  };
```

Keep the existing per-market `try`/`catch` and the `if (cancelled) return;`
check inside the loop. Add a comment explaining **why** the guard exists (a pass
slower than the 10 s interval otherwise overlaps the next one against a
rate-limited API).

**Verify**: `bun run typecheck` → no increase over baseline.

### Step 4 (optional, only if Step 1 made worst-case latency unacceptable)

If you concluded in Step 1 that N×15 s sequential worst case is too slow,
bound concurrency rather than removing the timeout: resolve in small batches
(for example 4 at a time) with `Promise.all` over each batch, each call still
wrapped in its own `withResolveTimeout`. Do not fire all N at once — Polymarket
Gamma is rate-limited and this runs on every watchlist change.

If you do this, say so in your report and make sure the Step 5 tests still
assert per-market independence.

**Verify**: `bun test src/plugins/prediction-markets/watchlist-quotes.test.ts` → all pass.

### Step 5: Add regression tests

Create `src/plugins/prediction-markets/watchlist-quotes.test.ts`.

The load-bearing behaviour to lock in is **per-market timeout independence**:
one slow or hanging market must not prevent later markets from resolving. That
is the regression with a concrete, previously-shipped failure mode.

To test `resolvePolymarketSummaries` you need to control
`resolvePolymarketMarketById`. Check first whether it is exported and how the
module is structured (`grep -rn "resolvePolymarketMarketById" src/plugins/prediction-markets/`).

**Important constraint on mocking:** this repo has a documented history of
cross-test pollution from `mock.module()`, which is process-wide and permanent.
If you use `mock.module()`, you MUST capture the real namespace first with
`await import()` and reinstall it in `afterAll`. There are two existing files
that do this correctly — read one and copy the pattern:
`src/remote/controller.test.ts` and
`src/plugins/builtin/chart-composer/catalog-prefetch.test.ts`.

If `resolvePolymarketSummaries` is not exported, prefer extracting and testing
`withResolveTimeout` directly (a pure, dependency-free function) plus one test
that a hanging promise resolves to `null` after the timeout while a fast promise
resolves to its value. That is lower-value than the integration test but far
more robust; note the tradeoff in your report. **Do not export a function purely
to make it testable without saying so in your report.**

Cases to cover:
1. A market whose fetch hangs past the timeout resolves to `null`, and a
   *subsequent* market with a fast fetch still resolves successfully. This is
   the exact bug. Assert the second market IS present in the result map.
2. Both key forms are populated for a resolved market (`info.marketKey` and
   `` `${info.venue}:${info.marketId}` ``).
3. A fetch that throws is skipped without aborting the batch.

Use fake or short timers so the suite stays fast — do not let a test actually
wait 15 s. If you use `bun:test` fake timers, be aware the repo installs a
timer-backed `requestAnimationFrame` in `src/test-support/setup.ts` via
`bunfig.toml` preload; check that fake timers do not conflict with it, and if
they do, use a short real timeout instead and inject the timeout value.

**Verify**: `bun test src/plugins/prediction-markets/watchlist-quotes.test.ts`
→ all pass. Then `bun test src/plugins/prediction-markets/` → no new failures
compared to baseline.

### Step 6: Verify end-to-end in a real terminal

Unit tests cannot prove the live bridge works — the original bug survived unit
tests. Per AGENTS.md, *"Use tmux to test terminal TUI changes"* and *"Always
kill the tmux session when done."*

Run the app against a **throwaway data dir** so you never touch real user state:

```sh
# copy a data dir if you need existing watchlists, or start clean
mkdir -p /tmp/qa-066
tmux new-session -d -s pmqa066 -x 200 -y 50 \
  "bun run src/cli/entry.ts --data-dir /tmp/qa-066"
sleep 15
tmux capture-pane -p -t pmqa066 | head -60
```

Add enough prediction-market tickers to a watchlist to exceed what the old
shared 15 s budget could cover (a dozen or more is a good test), then confirm
that the markets **late in the list** show live odds rather than a frozen value,
and that odds update over time.

Kill the session when done: `tmux kill-session -t pmqa066`.

If you cannot reach a state with many PM tickers, say so explicitly in your
report rather than claiming verification you did not perform.

**Verify**: captured pane output shows non-frozen odds on markets beyond the
first few, and `tmux ls` no longer lists `pmqa066`.

## Test plan

- New file `src/plugins/prediction-markets/watchlist-quotes.test.ts` with the
  three cases in Step 5, the first being the per-market-timeout regression.
- Structural pattern for module mocking with proper restore:
  `src/remote/controller.test.ts`.
- Verification: `bun test src/plugins/prediction-markets/` → no new failures
  versus the baseline you recorded, and the new tests pass.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` error count is **not higher** than the baseline
      recorded at the start (baseline: 27-29 per sub-project, exit 2)
- [ ] `bun test` failure count is **not higher** than the baseline recorded at
      the start (baseline: ~91)
- [ ] `bun test src/plugins/prediction-markets/watchlist-quotes.test.ts` passes,
      including a test that a hanging early market does not starve a later one
- [ ] The `timeout` promise is no longer created outside the resolution loop:
      `grep -n "new Promise<void>((resolve) => setTimeout(resolve, POLYMARKET" src/plugins/prediction-markets/watchlist-quotes.ts`
      returns no matches
- [ ] The retry `setTimeout` handle is stored and cleared in the effect cleanup,
      and the retry count is capped
- [ ] The Kalshi poller has an `inFlight` guard reset in a `finally`
- [ ] No files outside the in-scope list are modified (`git status --short`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" do not match the live code (the file has
  drifted since this plan was written).
- `resolvePolymarketMarketById` turns out to have its own internal timeout or
  retry that interacts with the per-market budget — report the interaction
  rather than layering a third timeout on top.
- Making the resolution per-market causes a visible latency regression you
  cannot bound with Step 4's batching.
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file — in particular, if
  you conclude the real problem is in the coordinator or the WebSocket
  transport, STOP and report instead of expanding scope.
- Test or typecheck counts **increase** above your recorded baseline.
- You discover the assumption "resolution is sequential and a shared deadline
  starves later markets" is false.

## Maintenance notes

- **What a reviewer should scrutinise**: that the timeout is created *inside* the
  loop (or per batch), that `clearTimeout` runs on the success path as well as
  the timeout path, and that the effect cleanup cancels the retry timer. All
  three are easy to regress back to the shared-deadline shape.
- **Interaction risk**: if resolution is ever made parallel across the whole
  list, revisit the Kalshi in-flight guard and the retry cap together — they
  currently assume sequential, bounded work.
- **Related known issue, deliberately not fixed here**: `pollKalshiWatchlistQuotes`
  uses `fetchJson<any>`. Replacing that `any` with a validated record type is
  worthwhile but out of scope; it is a separate typing concern and would enlarge
  this diff.
- **Deferred**: this plan does not add an automated check that watchlist odds
  actually advance over time. That belongs to the QA invariant layer (plan 071),
  which proposes a `quote-timestamp-advances` invariant runnable as a scheduled
  live canary. Until that exists, Step 6's manual tmux check is the only
  end-to-end proof, which is precisely why the original bug shipped.
