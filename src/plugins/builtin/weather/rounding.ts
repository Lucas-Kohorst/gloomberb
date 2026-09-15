/**
 * ASOS 5-minute / OMO feeds round whole °F → whole °C → °F. Degrees that
 * never appear on those feeds are "blind spots" and can only print via
 * METAR, SPECI, DSM, or CLI.
 */

export function fahrenheitFromWholeCelsius(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export function isBlindSpotF(degree: number): boolean {
  if (!Number.isInteger(degree)) return false;
  for (let celsius = -80; celsius <= 60; celsius += 1) {
    if (fahrenheitFromWholeCelsius(celsius) === degree) return false;
  }
  return true;
}

export function probableRangeF(tempF: number): { min: number; max: number } {
  const rounded = Math.round(tempF);
  return { min: rounded - 0.5, max: rounded + 0.4 };
}

export function blindSpotDegrees(minF: number, maxF: number): number[] {
  const degrees: number[] = [];
  for (let degree = Math.ceil(minF); degree <= Math.floor(maxF); degree += 1) {
    if (isBlindSpotF(degree)) degrees.push(degree);
  }
  return degrees;
}
