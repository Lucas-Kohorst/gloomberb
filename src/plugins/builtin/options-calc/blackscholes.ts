/**
 * Black-Scholes options pricing model — pure functions.
 *
 * European exercise only. All rates are in decimal (0.05 = 5%).
 * Theta is returned per calendar day, vega per 1% vol, rho per 1% rate.
 */

export interface BSInputs {
  /** S — underlying spot price */
  spot: number;
  /** K — strike price */
  strike: number;
  /** T — years to expiry */
  timeToExpiry: number;
  /** r — annual risk-free rate (decimal, e.g. 0.05) */
  riskFreeRate: number;
  /** sigma — annualized volatility (decimal, e.g. 0.25) */
  volatility: number;
  /** q — annual dividend yield (decimal, e.g. 0.02) */
  dividendYield: number;
}

export interface BSGreeks {
  price: number;
  delta: number;
  gamma: number;
  /** Per calendar day */
  theta: number;
  /** Per 1% volatility change */
  vega: number;
  /** Per 1% risk-free rate change */
  rho: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const DAYS_PER_YEAR = 365;

/**
 * Standard normal PDF.
 */
export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF using the Abramowitz & Stegun 7.1.26 approximation.
 * Max error < 7.5e-8.
 */
export function normCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * erf);
}

interface Intermediate {
  d1: number;
  d2: number;
  sqrtT: number;
  discountQ: number;
  discountR: number;
}

function computeIntermediate(inputs: BSInputs): Intermediate | null {
  const { spot, strike, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;
  if (spot <= 0 || strike <= 0 || timeToExpiry <= 0 || volatility <= 0) return null;

  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 = (Math.log(spot / strike) + (riskFreeRate - dividendYield + 0.5 * volatility * volatility) * timeToExpiry) / (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  const discountQ = Math.exp(-dividendYield * timeToExpiry);
  const discountR = Math.exp(-riskFreeRate * timeToExpiry);
  return { d1, d2, sqrtT, discountQ, discountR };
}

export function blackScholesCall(inputs: BSInputs): BSGreeks {
  const inter = computeIntermediate(inputs);
  if (!inter) return intrinsicGreeks(inputs, "call");

  const { spot, strike, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;
  const { d1, d2, sqrtT, discountQ, discountR } = inter;

  const nd1 = normPDF(d1);
  const nD1 = normCDF(d1);
  const nD2 = normCDF(d2);

  const price = spot * discountQ * nD1 - strike * discountR * nD2;
  const delta = discountQ * nD1;
  const gamma = (discountQ * nd1) / (spot * volatility * sqrtT);
  const thetaAnnual =
    (-spot * nd1 * volatility * discountQ) / (2 * sqrtT)
    - riskFreeRate * strike * discountR * nD2
    + dividendYield * spot * discountQ * nD1;
  const theta = thetaAnnual / DAYS_PER_YEAR;
  const vega = (spot * discountQ * nd1 * sqrtT) / 100;
  const rho = (strike * timeToExpiry * discountR * nD2) / 100;

  return { price, delta, gamma, theta, vega, rho };
}

export function blackScholesPut(inputs: BSInputs): BSGreeks {
  const inter = computeIntermediate(inputs);
  if (!inter) return intrinsicGreeks(inputs, "put");

  const { spot, strike, timeToExpiry, riskFreeRate, volatility, dividendYield } = inputs;
  const { d1, d2, sqrtT, discountQ, discountR } = inter;

  const nd1 = normPDF(d1);
  const nNegD1 = normCDF(-d1);
  const nNegD2 = normCDF(-d2);

  const price = strike * discountR * nNegD2 - spot * discountQ * nNegD1;
  const delta = -discountQ * nNegD1;
  const gamma = (discountQ * nd1) / (spot * volatility * sqrtT);
  const thetaAnnual =
    (-spot * nd1 * volatility * discountQ) / (2 * sqrtT)
    + riskFreeRate * strike * discountR * nNegD2
    - dividendYield * spot * discountQ * nNegD1;
  const theta = thetaAnnual / DAYS_PER_YEAR;
  const vega = (spot * discountQ * nd1 * sqrtT) / 100;
  const rho = (-strike * timeToExpiry * discountR * nNegD2) / 100;

  return { price, delta, gamma, theta, vega, rho };
}

/**
 * Returns intrinsic-value Greeks when inputs are degenerate (T→0 or σ→0).
 */
function intrinsicGreeks(inputs: BSInputs, type: "call" | "put"): BSGreeks {
  const { spot, strike, riskFreeRate, timeToExpiry } = inputs;
  const discountR = timeToExpiry > 0 ? Math.exp(-riskFreeRate * timeToExpiry) : 1;
  const intrinsic = type === "call"
    ? Math.max(0, spot - strike * discountR)
    : Math.max(0, strike * discountR - spot);
  const delta = type === "call"
    ? spot > strike ? 1 : 0
    : spot < strike ? -1 : 0;
  return { price: intrinsic, delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
}

export function blackScholes(inputs: BSInputs, type: "call" | "put"): BSGreeks {
  return type === "call" ? blackScholesCall(inputs) : blackScholesPut(inputs);
}

/**
 * Solve for implied volatility using Newton-Raphson with bisection fallback.
 * Returns null if no solution converges.
 */
export function impliedVolatility(
  marketPrice: number,
  inputs: Omit<BSInputs, "volatility">,
  type: "call" | "put",
): number | null {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return null;
  const { spot, strike, timeToExpiry, riskFreeRate, dividendYield } = inputs;
  if (spot <= 0 || strike <= 0 || timeToExpiry <= 0) return null;

  // Intrinsic bounds check
  const discountR = Math.exp(-riskFreeRate * timeToExpiry);
  const lowerBound = type === "call"
    ? Math.max(0, spot * Math.exp(-dividendYield * timeToExpiry) - strike * discountR)
    : Math.max(0, strike * discountR - spot * Math.exp(-dividendYield * timeToExpiry));
  if (marketPrice < lowerBound - 1e-6) return null;

  const MAX_ITER = 100;
  const TOL = 1e-6;
  let sigma = 0.2; // initial guess
  let low = 1e-4;
  let high = 5.0;

  for (let i = 0; i < MAX_ITER; i++) {
    const result = blackScholes({ ...inputs, volatility: sigma }, type);
    const diff = result.price - marketPrice;

    if (Math.abs(diff) < TOL) return sigma;

    // Narrow bisection bracket
    if (diff > 0) {
      high = sigma;
    } else {
      low = sigma;
    }

    // Newton-Raphson step using vega (per 1% → scale back to raw)
    const rawVega = result.vega * 100;
    if (rawVega > 1e-10) {
      const nextSigma = sigma - diff / rawVega;
      if (nextSigma > low && nextSigma < high) {
        sigma = nextSigma;
        continue;
      }
    }

    // Bisection fallback
    sigma = (low + high) / 2;
  }

  // Final check
  const finalResult = blackScholes({ ...inputs, volatility: sigma }, type);
  return Math.abs(finalResult.price - marketPrice) < TOL * 10 ? sigma : null;
}
