# Plan 029: Add Black-Scholes Options Calculator pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3381ada..HEAD -- src/plugins/builtin/options/ src/plugins/builtin/chart-composer/`
> If the options or chart-composer pattern has changed significantly, treat as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: godel-parity
- **Planned at**: commit `3381ada`, 2026-08-17

## Why this matters

A Black-Scholes options pricing calculator is a standard terminal function (Godel's `OVME`). It lets users compute theoretical option prices, Greeks, and implied volatility from input parameters. Gloom has an option chain viewer (`OMON`) but no interactive pricing calculator. This is a pure-math feature requiring no external data source — the lowest-risk gap to close.

## Godel reference

- **Command**: `OVME` (Black-Scholes)
- **Docs**: https://godelterminal.com/docs/commands/ovme.html
- **Function**: Black-Scholes options pricing model with inputs (spot price, strike, time to expiry, risk-free rate, volatility, dividend yield) and outputs (theoretical price, delta, gamma, theta, vega, rho, implied volatility).

## Current state

**Existing patterns to follow:**

1. **Options tab** (`src/plugins/builtin/options/`) — option chain display with `OMON` shortcut. The calculator complements this by providing theoretical pricing.

2. **Kelly sizer pane** (`src/plugins/builtin/kelly-sizer/`) — a pure-computation pane with input fields and computed output. This is the closest pattern: user inputs values, the pane computes results locally with no network calls.

3. **Chart composer** (`src/plugins/builtin/chart-composer/`) — interactive pane with settings and computed visualizations.

**Data source:**

None required. The Black-Scholes model is pure mathematics. Optionally, the pane can pre-fill spot price and volatility from the currently selected ticker's market data (if available), but the core computation is local.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bun run typecheck:opentui`      | exit 0              |
| Full TC   | `bun run typecheck`              | exit 0              |
| Tests     | `bun test`                       | all pass            |
| TUI test  | tmux session (see tui-testing skill) | pane renders     |

## Scope

**In scope** (create these files):
- `src/plugins/builtin/options-calc/blackscholes.ts` — Black-Scholes pricing + Greeks math (pure functions)
- `src/plugins/builtin/options-calc/blackscholes.test.ts` — unit tests for the math
- `src/plugins/builtin/options-calc/pane.tsx` — React pane component with input fields and output display
- `src/plugins/builtin/options-calc/index.tsx` — PluginModule definition with pane + shortcut

**Modify**:
- `src/plugins/builtin/composite-plugins.ts` — add module to `portfolioPlugin`
- `src/plugins/catalog-backend.ts` — add import and registration
- `src/plugins/catalog-ui.ts` — add import and registration
- `README.md` — add `OVME` to command reference table

**Out of scope**:
- Binomial/trinomial tree models (start with Black-Scholes only)
- American exercise style (Black-Scholes is European; note this limitation in the pane)
- Volatility surface visualization
- Connection to live option chain data for IV back-solving (can be a future enhancement)

## Git workflow

- Branch: `advisor/029-options-calc`
- Commit per file or logical unit; match repo commit style
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create Black-Scholes math

Create `src/plugins/builtin/options-calc/blackscholes.ts` with pure functions:

```typescript
export interface BSInputs {
  spot: number;        // S - underlying price
  strike: number;      // K - strike price
  timeToExpiry: number; // T - years to expiry
  riskFreeRate: number; // r - annual risk-free rate (decimal, e.g. 0.05)
  volatility: number;   // sigma - annualized volatility (decimal, e.g. 0.25)
  dividendYield: number; // q - annual dividend yield (decimal, e.g. 0.02)
}

export interface BSGreeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;  // per day
  vega: number;   // per 1% vol change
  rho: number;    // per 1% rate change
}

// Standard normal CDF (Abramowitz & Stegun approximation)
function normCDF(x: number): number { ... }

// Standard normal PDF
function normPDF(x: number): number { ... }

export function blackScholesCall(inputs: BSInputs): BSGreeks { ... }
export function blackScholesPut(inputs: BSInputs): BSGreeks { ... }
export function impliedVolatility(
  marketPrice: number,
  inputs: Omit<BSInputs, "volatility">,
  type: "call" | "put",
): number | null { ... }  // Newton-Raphson or bisection
```

Reference formulas:
- d1 = (ln(S/K) + (r - q + σ²/2)T) / (σ√T)
- d2 = d1 - σ√T
- Call = S·e^(-qT)·N(d1) - K·e^(-rT)·N(d2)
- Put = K·e^(-rT)·N(-d2) - S·e^(-qT)·N(-d1)
- Delta(call) = e^(-qT)·N(d1)
- Gamma = e^(-qT)·n(d1) / (S·σ·√T)
- Theta(call) = (-S·n(d1)·σ·e^(-qT))/(2√T) - r·K·e^(-rT)·N(d2) + q·S·e^(-qT)·N(d1)
- Vega = S·e^(-qT)·n(d1)·√T
- Rho(call) = K·T·e^(-rT)·N(d2)

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 2: Create unit tests

Create `src/plugins/builtin/options-calc/blackscholes.test.ts` with test cases:
- Known Black-Scholes values (e.g., S=100, K=100, T=1, r=0.05, σ=0.2, q=0 → Call ≈ 10.4506, Put ≈ 5.5735)
- Edge cases: T→0 (intrinsic value), σ→0, deep ITM/OTM
- Implied volatility: known IV back-solve
- Greeks sign conventions (delta positive for calls, negative for puts)

**Verify**: `bun test src/plugins/builtin/options-calc/blackscholes.test.ts` → all pass

### Step 3: Create pane component

Create `src/plugins/builtin/options-calc/pane.tsx` following the Kelly sizer pattern:
- **Input section** (left or top): `NumberField` for Spot, Strike, Time to Expiry (days → convert to years), Risk-Free Rate (%), Volatility (%), Dividend Yield (%)
- `SegmentedControl` for Call/Put toggle
- **Output section** (right or bottom): computed Price, Delta, Gamma, Theta, Vega, Rho displayed as labeled rows
- Optional: pre-fill spot price from `usePaneTicker()` market data if available
- `usePaneSettingsValue` for persisting last-used inputs
- `usePaneStatusFooter` for any status (e.g., "IV solved: 24.3%")
- `EmptyState` is not needed (always has default inputs)
- All computation is local — no loading states needed

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 4: Create plugin module

Create `src/plugins/builtin/options-calc/index.tsx`:

```typescript
import type { PluginModule } from "../plugin-module";

export const optionsCalcModule: PluginModule = {
  panes: [{
    id: "options-calc",
    name: "Options Calculator",
    icon: "O",
    component: OptionsCalcPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 70, height: 20 },
  }],
  paneTemplates: [{
    id: "options-calc-pane",
    paneId: "options-calc",
    label: "Black-Scholes Calculator",
    description: "Compute option prices and Greeks with the Black-Scholes model.",
    keywords: ["options", "black-scholes", "ovme", "calculator", "greeks", "delta", "gamma", "theta", "vega", "rho", "iv", "implied", "volatility"],
    shortcut: { prefix: "OVME" },
  }],
  // No setup needed — pure computation, no connection source
};
```

Note: No `registerConnectionSource()` needed since there is no external data source. If the pane optionally fetches spot price from Yahoo, register a connection source at that point.

**Verify**: `bun run typecheck:opentui` → exit 0

### Step 5: Register in composite plugin and catalogs

Add `optionsCalcModule` to `portfolioPlugin` in `src/plugins/builtin/composite-plugins.ts`. Add imports to `src/plugins/catalog-backend.ts` and `src/plugins/catalog-ui.ts`.

**Verify**: `bun run typecheck` → exit 0

### Step 6: Update README

Add `OVME` to the command reference table in `README.md`.

**Verify**: `bun run typecheck` → exit 0

### Step 7: TUI test

Use tmux to verify:
1. Start TUI in tmux
2. Open command bar, type `OVME`, Enter
3. Verify pane opens with input fields and output display
4. Enter S=100, K=100, T=365 days, r=5%, σ=20%, q=0%
5. Verify Call price ≈ 10.45 and Greeks display
6. Toggle to Put, verify Put price ≈ 5.57
7. Kill tmux session

**Verify**: Pane renders with correct computed values

### Step 8: Full verification

**Verify**: `bun run typecheck` → exit 0, `bun test` → all pass

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun test` exits 0 (including new blackscholes.test.ts)
- [ ] `OVME` shortcut opens the pane in the TUI
- [ ] Black-Scholes call/put prices match known reference values
- [ ] All five Greeks (delta, gamma, theta, vega, rho) display correctly
- [ ] Call/Put toggle works
- [ ] Inputs persist across pane reopen (pane settings)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The `NumberField` component doesn't support the input format needed — check `src/plugins/builtin/kelly-sizer/` for the actual API.
- The computed values don't match reference Black-Scholes values — re-check the formulas and normCDF approximation.

## Maintenance notes

- Black-Scholes assumes European exercise. The pane should note this limitation. American option pricing would require a binomial model (future enhancement).
- The implied volatility solver (Newton-Raphson) may not converge for extreme inputs. Use bisection as a fallback.
- Consider adding a mini volatility smile chart as a future enhancement if IV data from the option chain is available.
