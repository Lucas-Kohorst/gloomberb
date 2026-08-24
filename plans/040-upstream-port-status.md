# 040 — Upstream port status (`gloom-sh/gloomberb`)

Review of upstream commits the fork has not taken, with a decision on each.

## Remote reality check

`origin` points at **the fork**, not upstream. Upstream is the `gloomsh` remote.
`AGENTS.md` describes it the other way around and should be corrected.

```
fork / origin  ->  Lucas-Kohorst/gloomberb   (push here)
gloomsh        ->  gloom-sh/gloomberb        (read-only)
```

State at time of review: fork is **299 ahead / 56 behind**, merge base
`9031a772` (upstream #547).

## Do not merge upstream

1039 files and ~89k insertions differ. More decisively, upstream created its own
Cloudflare worker in **#611**, but `src/renderers/cloudflare/` did not exist at
the merge base, so **both sides created that directory independently with zero
shared history**. The fork's `worker.ts` is 733 lines (data providers, Gloom
Cloud proxy, share KV, origin gating); upstream's is 115. Any merge conflicts the
whole tree with no common ancestor to resolve against.

Hand-port instead, one small PR at a time.

> `AGENTS.md` claims the Cloudflare stack is fork-only. That is now stale —
> upstream has its own since #611. The claim should be reworded to "the fork's
> Cloudflare stack is independent of upstream's and shares no history with it".

## Also worth knowing

Upstream has exactly **one** plugin the fork lacks: `options-calculator` (the
fork has its own `options-calc`). The panes from #575-#606 are all already
hand-ported, which is why raw `git cherry` output is mostly noise.

**None** of the seven feature branches (plans 030-036) duplicate upstream work.
The closest call is upstream #591's volatility *curve* versus plan 035's
volatility *surface*; they are different things.

---

## Ported

### #620 — chart gesture containment → PR #188
React registers `onWheel` as a *passive* listener, so `preventDefault()` was
silently ignored and wheel-zooming a chart also scrolled the page. Rebound
natively with `{ passive: false }`, plus `touch-action: none` and
`overscroll-behavior: none` on chart surfaces. Upstream's regression test came
across too. **This was a live bug in the hosted client.**

### Security headers → PR #189
Hand-ported rather than merged, since the two workers share no history. Adds
`strict-transport-security`, `cross-origin-opener-policy`,
`cross-origin-resource-policy`, `permissions-policy`, and `x-robots-tag`
(share documents only, since shares are unlisted links rather than public pages).

CSP intentionally stays **report-only**. Upstream enforces it, but the fork's
`APP_CSP` still needs `unsafe-inline` for scripts, and flipping it risks breaking
the hosted client in ways the test suite cannot see. Separate change, needs
browser validation.

---

## Rejected

### #618 — "Fix persisted charts while markets are closed"
**Do not port as written.**

Upstream defaults a missing `exchange` to `"NASDAQ"` in
`isPriceHistoryStaleForCurrentWindow` and inverts the final return to
`!hasExchangeSession`, so history is no longer discarded merely because the
market is closed.

The fork deliberately went the other way in `b3c8c75b` ("Keep listing identity,
currency scale, and freshness honest so ... delayed Yahoo stamps ... cannot look
like live USD prices") and has a test pinning it:
`price-history.test.ts:53` — *"treats weekend-old listed history as stale instead
of a live session"*.

Applying upstream's patch flips that test. And the test is defending something
real: its fixture is `2026-05-15T15:30:00Z`, which is **11:30 ET on a Friday**,
mid-session, not the close. Viewed on the Sunday, that snapshot is genuinely
missing Friday afternoon. Upstream's version reports it as fresh, because
`isTimestampStaleForExchangeSession` only asks whether a session has *started*
since, not whether the recorded one *completed*.

So upstream fixes blank weekend charts but reintroduces silently truncated
sessions. All four call sites
(`market-data/coordinator/chart.ts:46`, `provider-router/history.ts:268,270`,
`provider-router/cache.ts:70`) are refetch/cache gating rather than display
labelling, so upstream's framing is reasonable, but the underlying function is
overloaded: "should I refetch?" and "is this data current?" are not the same
question.

**Recommendation:** if weekend chart blanking is actually being observed, fix it
by splitting those two questions apart, not by inverting this boolean.

---

## Deferred, highest remaining value

### #621 — "Keep CLI and offline edits from being overwritten by cloud sync"
**The fork genuinely has this bug.** Sync keeps no record of what a device
already uploaded, so every launch treats local state as pristine and the cloud
copy wins. A portfolio or position created from the CLI while the app was closed
is reverted by the first pull after launch. This maps directly onto the fork's own
`AGENTS.md` rule: *"Do not let a stale cloud pull wipe a newer hosted local
save."*

The fork's only existing protection is `shouldKeepNewerHostedLocalConfig()`,
which compares a hosted persist timestamp against the snapshot's `createdAt`.
That is hosted-only and whole-config. The desktop/CLI case has **no** protection.

Port feasibility, measured against upstream's parent `3a479776^`:

| File | Divergence | Notes |
|---|---|---|
| `src/sync/baseline.ts` | new | drops in clean |
| `src/sync/types.ts` | 0 lines | clean patch |
| `src/sync/controller.ts` | 9 lines | near-clean |
| `src/sync/react.ts` | 73 lines | 1 conflict, imports only, trivial |
| `src/sync/core-contributors.ts` | 111 lines | **4 conflicts, substantive** |
| `notes/*` | — | **skip entirely** |

Two blockers:

1. **Competing designs.** The fork guards by timestamp; upstream guards per field
   by comparing against the last uploaded baseline. Upstream's approach is
   better (per-field, and it covers CLI/offline rather than just hosted), but
   merging means keeping the fork's hosted stamp guard *and* threading
   `baselinePayload` through, plus reconciling the fork's extra
   portfolio/watchlist merge in the ticker contributor against upstream's
   `tickerChangedSinceLastSync` guard.

2. **Hidden dependency.** Upstream's #621 code calls
   `collectAccountsByPortfolio`, which comes from **#597 ("Sync broker account
   values to mobile")** — an unported commit serving upstream's mobile app. So
   #621 is not self-contained.

Skip the notes half: it does not apply. Upstream had no notes sync at all and
added a contributor in #621; the fork **already syncs notes** through its own
`createNotesSyncContributor` (`plugins/builtin/notes/sync.ts`, registered at
`notes/index.tsx:19`).

**Recommended scope:** port only the baseline mechanism — `baseline.ts`,
`types.ts`, `controller.ts`, the `react.ts` import merge — then adapt
`core-contributors.ts` by hand, keeping the hosted stamp guard and stubbing out
the `#597` broker-account surface. Validate `src/sync/` **in isolation**;
`controller.test.ts` is order-dependent and gives a misleading signal in a full
run.

This is the one item deliberately left undone. It touches the code path that owns
user portfolios, and the failure mode is silent data loss, so it should not be
merged on inspection alone.

### #617 — anonymous delayed market data
**Product decision, not a port.**

Upstream dropped `requireVerifiedSession()` from 16 call sites down to 6 and made
`canProvide()` return `true`, so anonymous visitors get delayed data. The fork
still gates all 16, which means **a first-time visitor to terminal.kohor.st sees
no market data at all**.

That is a real funnel problem, but adopting it interacts with the fork's own
`2171bdba` ("stop anonymous session request storms") and changes who can consume
quota without signing in. Needs an explicit call on cost and abuse exposure.

### #619 — Apple app-site-association
Not applicable. Upstream-specific: `term.gloom.sh/s/*` with team
`3XQML3UV65.sh.gloom.companion`.

---

## Suggested order for the remainder

1. **#621 baseline half** — real bug, real data-loss risk, needs care
2. **#617 posture** — decide first, then implement; it is a one-line-ish change
   once decided
3. `AGENTS.md` corrections — the `origin`/`gloomsh` swap and the stale
   "Cloudflare stack is fork-only" claim
4. Optional: upstream's `options-calculator` plugin, and the P3 Kalshi proxy
   OPTIONS/preflight gap
