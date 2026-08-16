# Plan 015: Replace `error: any` with `error: unknown` in IBKR catch blocks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 7065caf..HEAD -- src/plugins/ibkr/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7065caf`, 2026-08-16

## Why this matters

14 catch blocks across the IBKR plugin use `catch (error: any)` followed by
`error?.message || "..."`. Using `any` suppresses all type checking on the
error object. If a non-Error value is thrown (e.g., a string or a custom error
class without `.message`), the fallback message masks the real error, making
debugging harder in trading paths. TypeScript's `unknown` type enforces type
narrowing before property access, which is the correct pattern for caught errors.

## Current state

The pattern appears at 14 sites across the IBKR plugin:

**`src/plugins/ibkr/trade/tab/actions.tsx`** — lines 115, 226, 330, 360:
```typescript
    } catch (error: any) {
      setTradeTicketMessage(symbol, undefined, error?.message || `Failed to ...`, ticker);
    }
```

**`src/plugins/ibkr/trading/pane.tsx`** — lines 137, 209:
```typescript
    } catch (error: any) {
      // similar pattern
    }
```

**`src/plugins/ibkr/gateway/service/lifecycle.ts`** — lines 147, 177:
```typescript
    } catch (error: any) {
      // similar pattern
    }
```

**`src/plugins/ibkr/gateway/account-loaders.ts`** — lines 217, 258:
```typescript
    } catch (error: any) {
      // similar pattern
    }
```

**`src/plugins/ibkr/gateway/market-data.ts`** — line 22:
```typescript
    } catch (error: any) {
      // similar pattern
    }
```

Find all sites with:
```
grep -rn "catch (error: any)" src/plugins/ibkr/
```

**Convention**: TypeScript with `strict: true` (see `tsconfig.json`). The
correct pattern for caught errors is `catch (error: unknown)` with type
narrowing: `error instanceof Error ? error.message : String(error)`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `bun install`            | exit 0              |
| Typecheck | `bun run typecheck`      | exit 0, no errors   |
| Tests     | `bun test`               | all pass            |

## Scope

**In scope** (the only files you should modify):
- All files under `src/plugins/ibkr/` that contain `catch (error: any)`

**Out of scope** (do NOT touch):
- Non-IBKR files with the same pattern (those are separate findings if they exist)
- The logic inside the catch blocks — only the type annotation and error
  access pattern change
- Any other `any` usage in the IBKR plugin

## Git workflow

- Branch: `advisor/015-ibkr-error-unknown`
- Commit message: `Replace error: any with error: unknown in IBKR catch blocks`

## Steps

### Step 1: Find all sites and replace

Run:
```
grep -rn "catch (error: any)" src/plugins/ibkr/
```

For each site, replace:

```typescript
// Before:
} catch (error: any) {
  ... error?.message || "fallback" ...
}

// After:
} catch (error: unknown) {
  ... error instanceof Error ? error.message : String(error) || "fallback" ...
}
```

The exact replacement depends on how `error` is used in each catch block. The
common patterns are:

Pattern A — direct message access:
```typescript
// Before:
error?.message || "fallback"
// After:
(error instanceof Error ? error.message : String(error)) || "fallback"
```

Pattern B — error stored in a variable:
```typescript
// Before:
const msg = error?.message;
// After:
const msg = error instanceof Error ? error.message : undefined;
```

Pattern C — error passed to a function:
```typescript
// Before:
someFunc(error?.message)
// After:
someFunc(error instanceof Error ? error.message : String(error))
```

Read each catch block to determine which pattern applies. Do not change any
other logic.

**Verify**: `bun run typecheck` → exit 0, no errors

### Step 2: Verify no remaining `error: any` in IBKR

**Verify**: `grep -rn "catch (error: any)" src/plugins/ibkr/` returns no matches

### Step 3: Verify tests pass

**Verify**: `bun test` → all pass

## Test plan

- No new tests needed — this is a type-safety improvement with no runtime
  behavior change. The existing test suite confirms no behavior regression.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0 (no regressions)
- [ ] `grep -rn "catch (error: any)" src/plugins/ibkr/` returns no matches
- [ ] `grep -rn "catch (error: unknown)" src/plugins/ibkr/` returns matches at the same files
- [ ] No files outside `src/plugins/ibkr/` are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A catch block uses `error` in a way that can't be simply narrowed with
  `instanceof Error` (e.g., it accesses non-standard properties like
  `error.code` or `error.statusCode`) — report the file and line so a custom
  type guard can be designed.
- `typecheck` fails after the change with errors that aren't trivially fixable
  — report the errors.
- The number of sites is significantly different from 14 (more or fewer) —
  report the actual count.

## Maintenance notes

- If new catch blocks are added to the IBKR plugin, they should use
  `catch (error: unknown)` from the start. Consider adding this to AGENTS.md
  as a coding guideline.
- If an IBKR error class with custom properties (e.g., `IbkrError.code`) is
  introduced, add a type guard: `isIbkrError(error): error is IbkrError`.
