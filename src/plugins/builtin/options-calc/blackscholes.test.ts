import { test, expect } from "bun:test";
import {
  blackScholesCall,
  blackScholesPut,
  blackScholes,
  impliedVolatility,
  normCDF,
  normPDF,
  type BSInputs,
} from "./blackscholes";

const REF: BSInputs = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  riskFreeRate: 0.05,
  volatility: 0.2,
  dividendYield: 0,
};

test("normCDF known values", () => {
  expect(normCDF(0)).toBeCloseTo(0.5, 6);
  expect(normCDF(1.96)).toBeCloseTo(0.975, 3);
  expect(normCDF(-1.96)).toBeCloseTo(0.025, 3);
});

test("normPDF is symmetric and peaks at zero", () => {
  const peak = normPDF(0);
  expect(peak).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 8);
  expect(normPDF(1)).toBeCloseTo(normPDF(-1), 10);
  expect(normPDF(0)).toBeGreaterThan(normPDF(1));
});

test("reference call price matches known Black-Scholes value", () => {
  const call = blackScholesCall(REF);
  expect(call.price).toBeCloseTo(10.4506, 2);
});

test("reference put price matches known Black-Scholes value", () => {
  const put = blackScholesPut(REF);
  expect(put.price).toBeCloseTo(5.5735, 2);
});

test("put-call parity holds", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  const forward = REF.spot * Math.exp(-REF.dividendYield * REF.timeToExpiry)
    - REF.strike * Math.exp(-REF.riskFreeRate * REF.timeToExpiry);
  expect(call.price - put.price).toBeCloseTo(forward, 4);
});

test("call delta is positive, put delta is negative", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  expect(call.delta).toBeGreaterThan(0);
  expect(call.delta).toBeLessThan(1);
  expect(put.delta).toBeLessThan(0);
  expect(put.delta).toBeGreaterThan(-1);
  // put-call delta parity: call - put = e^(-qT)
  expect(call.delta - put.delta).toBeCloseTo(Math.exp(-REF.dividendYield * REF.timeToExpiry), 4);
});

test("gamma is identical for call and put", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  expect(call.gamma).toBeCloseTo(put.gamma, 8);
  expect(call.gamma).toBeGreaterThan(0);
});

test("vega is identical for call and put", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  expect(call.vega).toBeCloseTo(put.vega, 8);
  expect(call.vega).toBeGreaterThan(0);
});

test("theta is negative for both call and put at-the-money", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  expect(call.theta).toBeLessThan(0);
  expect(put.theta).toBeLessThan(0);
});

test("rho is positive for calls, negative for puts", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  expect(call.rho).toBeGreaterThan(0);
  expect(put.rho).toBeLessThan(0);
});

test("T→0 collapses to intrinsic value", () => {
  const inputs: BSInputs = { ...REF, timeToExpiry: 1e-9 };
  const call = blackScholesCall(inputs);
  const put = blackScholesPut(inputs);
  expect(call.price).toBeCloseTo(0, 2);
  expect(put.price).toBeCloseTo(0, 2);
});

test("T→0 ITM call collapses to intrinsic", () => {
  const inputs: BSInputs = { ...REF, spot: 120, timeToExpiry: 1e-9 };
  const call = blackScholesCall(inputs);
  expect(call.price).toBeCloseTo(20, 1);
  expect(call.delta).toBeCloseTo(1, 1);
});

test("T→0 ITM put collapses to intrinsic", () => {
  const inputs: BSInputs = { ...REF, spot: 80, timeToExpiry: 1e-9 };
  const put = blackScholesPut(inputs);
  expect(put.price).toBeCloseTo(20, 1);
  expect(put.delta).toBeCloseTo(-1, 1);
});

test("deep ITM call has delta near 1", () => {
  const inputs: BSInputs = { ...REF, spot: 200 };
  const call = blackScholesCall(inputs);
  expect(call.delta).toBeGreaterThan(0.99);
});

test("deep OTM call has delta near 0", () => {
  const inputs: BSInputs = { ...REF, spot: 50 };
  const call = blackScholesCall(inputs);
  expect(call.delta).toBeLessThan(0.01);
});

test("dividend yield reduces call price", () => {
  const noDiv = blackScholesCall(REF);
  const withDiv = blackScholesCall({ ...REF, dividendYield: 0.05 });
  expect(withDiv.price).toBeLessThan(noDiv.price);
});

test("implied volatility back-solves to known sigma", () => {
  const sigma = 0.25;
  const inputs: BSInputs = { ...REF, volatility: sigma };
  const callPrice = blackScholesCall(inputs).price;
  const iv = impliedVolatility(callPrice, {
    spot: REF.spot,
    strike: REF.strike,
    timeToExpiry: REF.timeToExpiry,
    riskFreeRate: REF.riskFreeRate,
    dividendYield: REF.dividendYield,
  }, "call");
  expect(iv).not.toBeNull();
  expect(iv!).toBeCloseTo(sigma, 3);
});

test("implied volatility works for puts", () => {
  const sigma = 0.3;
  const inputs: BSInputs = { ...REF, volatility: sigma };
  const putPrice = blackScholesPut(inputs).price;
  const iv = impliedVolatility(putPrice, {
    spot: REF.spot,
    strike: REF.strike,
    timeToExpiry: REF.timeToExpiry,
    riskFreeRate: REF.riskFreeRate,
    dividendYield: REF.dividendYield,
  }, "put");
  expect(iv).not.toBeNull();
  expect(iv!).toBeCloseTo(sigma, 3);
});

test("implied volatility returns null for below-intrinsic price", () => {
  const iv = impliedVolatility(0.01, {
    spot: 100,
    strike: 90,
    timeToExpiry: 1,
    riskFreeRate: 0.05,
    dividendYield: 0,
  }, "call");
  expect(iv).toBeNull();
});

test("blackScholes dispatcher matches direct functions", () => {
  const call = blackScholesCall(REF);
  const put = blackScholesPut(REF);
  expect(blackScholes(REF, "call").price).toBeCloseTo(call.price, 10);
  expect(blackScholes(REF, "put").price).toBeCloseTo(put.price, 10);
});
