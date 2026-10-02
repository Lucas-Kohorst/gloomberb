export interface ParityQuote {
  strike: number;
  bid: number;
  ask: number;
  contractSymbol?: string;
}

const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Crossed, empty and one-sided markets cannot supply a midpoint. */
export function optionMid(quote: Pick<ParityQuote, "bid" | "ask">): number | null {
  return positive(quote.bid) && positive(quote.ask) && quote.ask >= quote.bid
    ? quote.bid + (quote.ask - quote.bid) / 2
    : null;
}

interface ParityPair {
  strike: number;
  forward: number;
  forwardBid: number;
  forwardAsk: number;
  call: string | null;
  put: string | null;
}

export interface ImpliedForward {
  forward: number | null;
  dividendYield: number | null;
  pairs: ParityPair[];
  method: "put-call-parity" | "unavailable";
  warnings: string[];
}

/**
 * Largest log gap between a parity forward and spot grown at the risk-free rate:
 * 5% for spot and chain observed at different times plus 100% a year of
 * dividend and borrow carry. Volatility indices settle on a future that can
 * trade far from the spot index, so they are exempt.
 */
function maxParityCarryLogGap(years: number, underlying?: string): number {
  if (underlying && VOLATILITY_INDEX.test(underlying)) return Infinity;
  return 0.05 + Math.max(0, years);
}

const VOLATILITY_INDEX = /^\^?(VIX(1D|9D|3M|6M)?|VVIX|VXN|VXD|RVX|OVX|GVZ|VXEEM|VXEFA|VXTLT)$/i;

/** Use the two nearest valid paired strikes on each side of spot, then their median. */
export function extractImpliedForward(
  calls: readonly ParityQuote[],
  puts: readonly ParityQuote[],
  spot: number,
  years: number,
  rate: number,
  underlying?: string,
): ImpliedForward {
  const unavailable = (reason: string): ImpliedForward => ({
    forward: null,
    dividendYield: null,
    pairs: [],
    method: "unavailable",
    warnings: [reason],
  });
  if (!positive(spot) || !positive(years) || !Number.isFinite(rate)) return unavailable("Invalid parity inputs");
  const growth = Math.exp(rate * years);
  if (!positive(growth)) return unavailable("Parity discount factor exceeds model precision");
  const quotesByStrike = (quotes: readonly ParityQuote[]) => {
    const map = new Map<number, ParityQuote>();
    for (const quote of quotes) {
      if (!positive(quote.strike) || optionMid(quote) == null) continue;
      const current = map.get(quote.strike);
      if (!current || quote.ask - quote.bid < current.ask - current.bid) map.set(quote.strike, quote);
    }
    return map;
  };
  const putMap = quotesByStrike(puts);
  const candidates: ParityPair[] = [];
  const maxGap = maxParityCarryLogGap(years, underlying);
  let implausible = 0;
  for (const call of quotesByStrike(calls).values()) {
    const put = putMap.get(call.strike);
    if (!put) continue;
    const forward = call.strike + (optionMid(call)! - optionMid(put)!) * growth;
    const forwardBid = call.strike + (call.bid - put.ask) * growth;
    const forwardAsk = call.strike + (call.ask - put.bid) * growth;
    if (![forward, forwardBid, forwardAsk].every(positive)) continue;
    if (Math.abs(Math.log(forward / spot) - rate * years) > maxGap) {
      implausible += 1;
      continue;
    }
    candidates.push({
      strike: call.strike,
      forward,
      forwardBid,
      forwardAsk,
      call: call.contractSymbol ?? null,
      put: put.contractSymbol ?? null,
    });
  }
  const below = candidates.filter((pair) => pair.strike <= spot).sort((a, b) => b.strike - a.strike).slice(0, 2);
  const above = candidates.filter((pair) => pair.strike > spot).sort((a, b) => a.strike - b.strike).slice(0, 2);
  const pairs = [...below, ...above].sort((a, b) => a.strike - b.strike);
  if (!pairs.length) {
    return unavailable(implausible
      ? "Parity forwards are inconsistent with spot"
      : "No paired two-sided quotes for put-call parity");
  }
  const forwards = pairs.map((pair) => pair.forward).sort((a, b) => a - b);
  const middle = Math.floor(forwards.length / 2);
  const forward = forwards.length % 2 ? forwards[middle]! : forwards[middle - 1]! / 2 + forwards[middle]! / 2;
  const dividendYield = rate - (Math.log(forward) - Math.log(spot)) / years;
  if (!Number.isFinite(dividendYield)) return unavailable("Implied carry exceeds model precision");
  const warnings: string[] = [];
  if (!below.length || !above.length) warnings.push("Parity strikes do not bracket spot");
  if (Math.max(...pairs.map((pair) => pair.forwardBid)) > Math.min(...pairs.map((pair) => pair.forwardAsk))) {
    warnings.push("Parity forward quote intervals disagree");
  }
  return { forward, dividendYield, pairs, method: "put-call-parity", warnings };
}
