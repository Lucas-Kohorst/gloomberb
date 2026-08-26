/**
 * Volatility surface — pure functions.
 *
 * Builds a 2D grid of implied volatilities (strikes × expirations) from option
 * chains by back-solving the Black-Scholes model against each contract's market
 * price, plus helpers to render the grid as a colored heatmap.
 */

import type { OptionContract, OptionsChain } from "../../../types/financials";
import { impliedVolatility } from "../options-calc/blackscholes";
import { blendHex, colors } from "../../../theme/colors";

const DAY_MS = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365 * DAY_MS;

/** Conservative fallback when no fundamentals-derived rate is available. */
export const DEFAULT_RISK_FREE_RATE = 0.045;

export interface VolSurfaceCell {
  strike: number;
  /** Unix seconds. */
  expiration: number;
  /** Decimal volatility (0.25 = 25%). */
  impliedVolatility: number;
  type: "call" | "put";
}

export interface VolSurface {
  underlyingSymbol: string;
  /** Ascending strike axis. */
  strikes: number[];
  /** Ascending expiration axis (unix seconds). */
  expirations: number[];
  /**
   * cells[strikeIndex][expirationIndex] — null when no marketable contract or
   * the solver failed to converge for that strike/expiration pair.
   */
  cells: (VolSurfaceCell | null)[][];
  minIv: number | null;
  maxIv: number | null;
}

export interface ComputeVolSurfaceOptions {
  spot: number | null;
  riskFreeRate?: number;
  dividendYield?: number | null;
  now?: number;
}

/** Coarse live-spot bucket so penny ticks do not rebuild the IV grid. */
export function quantizeVolSurfaceSpot(spot: number | null | undefined): number | null {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;
  const step = spot >= 50 ? 0.1 : 0.01;
  return Math.round(spot / step) * step;
}

function indexContractsByStrike(contracts: readonly OptionContract[]): Map<number, OptionContract> {
  const byStrike = new Map<number, OptionContract>();
  for (const contract of contracts) byStrike.set(contract.strike, contract);
  return byStrike;
}

/**
 * Mid price with a `lastPrice` fallback, matching the options-calc seed helper.
 * Returns null when no usable price exists.
 */
export function contractMarketPrice(
  contract: Pick<OptionContract, "bid" | "ask" | "lastPrice">,
): number | null {
  if (contract.bid > 0 && contract.ask > 0) return (contract.bid + contract.ask) / 2;
  if (contract.lastPrice > 0) return contract.lastPrice;
  return null;
}

/** Years to expiry, floored to one day so near-dated expiries stay solvable. */
export function yearsToExpiry(expirationUnixSec: number, nowMs = Date.now()): number {
  return Math.max(1 / 365, (expirationUnixSec * 1000 - nowMs) / MS_PER_YEAR);
}

/**
 * Pick the contract to back-solve for a given strike. Prefer the side with a
 * tighter, positive market price; fall back to whichever contract exists.
 */
function pickPricableContract(
  call: OptionContract | undefined,
  put: OptionContract | undefined,
): { contract: OptionContract; type: "call" | "put" } | null {
  const candidates: Array<{ contract: OptionContract; type: "call" | "put" }> = [];
  if (call) candidates.push({ contract: call, type: "call" });
  if (put) candidates.push({ contract: put, type: "put" });
  if (candidates.length === 0) return null;

  let best = candidates[0]!;
  let bestSpread = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const price = contractMarketPrice(candidate.contract);
    if (price == null || price <= 0) continue;
    const spread = candidate.contract.ask - candidate.contract.bid;
    if (spread < bestSpread) {
      bestSpread = spread;
      best = candidate;
    }
  }
  return best;
}

/**
 * Compute an implied-volatility surface across one or more option chains.
 *
 * Each entry in `chainsByExpiration` is keyed by its expiration timestamp
 * (unix seconds) and is expected to contain the calls/puts for that single
 * expiration. The returned surface unions strikes across every supplied chain.
 */
export function computeVolSurface(
  chainsByExpiration: ReadonlyMap<number, OptionsChain>,
  options: ComputeVolSurfaceOptions,
): VolSurface {
  const now = options.now ?? Date.now();
  const spot = options.spot;
  const riskFreeRate = options.riskFreeRate ?? DEFAULT_RISK_FREE_RATE;
  const dividendYield = options.dividendYield ?? 0;

  const expirations = [...chainsByExpiration.keys()].sort((a, b) => a - b);

  const strikeSet = new Set<number>();
  let underlyingSymbol = "";
  for (const chain of chainsByExpiration.values()) {
    if (!underlyingSymbol) underlyingSymbol = chain.underlyingSymbol;
    for (const c of chain.calls) strikeSet.add(c.strike);
    for (const p of chain.puts) strikeSet.add(p.strike);
  }
  const strikes = [...strikeSet].sort((a, b) => a - b);

  let minIv = Number.POSITIVE_INFINITY;
  let maxIv = Number.NEGATIVE_INFINITY;

  const contractsByExpiration = new Map<number, {
    calls: Map<number, OptionContract>;
    puts: Map<number, OptionContract>;
  }>();
  for (const expiration of expirations) {
    const chain = chainsByExpiration.get(expiration);
    if (!chain) continue;
    contractsByExpiration.set(expiration, {
      calls: indexContractsByStrike(chain.calls),
      puts: indexContractsByStrike(chain.puts),
    });
  }

  const cells: (VolSurfaceCell | null)[][] = strikes.map((strike) =>
    expirations.map((expiration) => {
      const indexed = contractsByExpiration.get(expiration);
      if (!indexed || spot == null || spot <= 0) return null;
      const call = indexed.calls.get(strike);
      const put = indexed.puts.get(strike);
      const picked = pickPricableContract(call, put);
      if (!picked) return null;
      const price = contractMarketPrice(picked.contract);
      if (price == null || price <= 0) return null;

      const timeToExpiry = yearsToExpiry(expiration, now);
      const iv = impliedVolatility(
        price,
        { spot, strike, timeToExpiry, riskFreeRate, dividendYield },
        picked.type,
      );
      if (iv == null || !Number.isFinite(iv) || iv <= 0) return null;
      if (iv < minIv) minIv = iv;
      if (iv > maxIv) maxIv = iv;
      return { strike, expiration, impliedVolatility: iv, type: picked.type };
    }),
  );

  return {
    underlyingSymbol,
    strikes,
    expirations,
    cells,
    minIv: Number.isFinite(minIv) ? minIv : null,
    maxIv: Number.isFinite(maxIv) ? maxIv : null,
  };
}

/** Normalize an IV to a [0, 1] heat scale. Returns 0 for degenerate ranges. */
export function normalizeIv(iv: number, minIv: number | null, maxIv: number | null): number {
  if (minIv == null || maxIv == null || maxIv <= minIv) return 0;
  const t = (iv - minIv) / (maxIv - minIv);
  return Math.max(0, Math.min(1, t));
}

/**
 * Heat color for an IV cell — cool green for low vol, warm red for high vol.
 * Returns a background hex string blended toward the pane background.
 */
export function volSurfaceCellBackground(
  iv: number,
  minIv: number | null,
  maxIv: number | null,
  surface: string = colors.bg,
): string {
  const t = normalizeIv(iv, minIv, maxIv);
  const heatColor = blendHex(colors.positive, colors.negative, t);
  // Scale blend strength so the strongest cells read clearly without washing out text.
  const ratio = 0.12 + t * 0.36;
  return blendHex(surface, heatColor, ratio);
}

/** Cell text color for an IV cell, brightened toward textBright for legibility. */
export function volSurfaceCellText(
  iv: number,
  minIv: number | null,
  maxIv: number | null,
  surface: string = colors.bg,
): string {
  void surface;
  const t = normalizeIv(iv, minIv, maxIv);
  const heatColor = blendHex(colors.positive, colors.negative, t);
  return blendHex(heatColor, colors.textBright, 0.45);
}

/** Format an IV cell value as a percentage string (e.g. "24.5"). */
export function formatIvCell(iv: number | null): string {
  if (iv == null || !Number.isFinite(iv)) return "—";
  return (iv * 100).toFixed(1);
}
