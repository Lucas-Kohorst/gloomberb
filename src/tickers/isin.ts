/**
 * ISIN (International Securities Identification Number) helpers.
 *
 * An ISIN is a 12-character code: a 2-letter ISO 3166 country/issuer prefix,
 * 9 alphanumeric characters identifying the security, and a single Luhn
 * check digit. These helpers validate the format and check digit so a
 * typed ISIN can be routed to local-metadata matching and provider search
 * without false-positiving on ordinary ticker symbols.
 */

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/**
 * Normalize raw input for validation: trim and upper-case. Returns the
 * cleaned string or an empty string when the input is not a string.
 */
export function normalizeIsin(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * True when `value` is a syntactically valid ISIN with a correct Luhn
 * check digit. Letters in the body are expanded to their decimal
 * equivalents (A=10 … Z=35) — each contributing two digits — before the
 * standard Luhn sum is applied to the full expanded digit string.
 */
export function isValidIsin(value: string): boolean {
  const isin = normalizeIsin(value);
  if (!ISIN_RE.test(isin)) return false;

  // Expand every character to its decimal digits. Digits 0–9 stay as-is;
  // letters A–Z become 10–35, written as two decimal digits.
  const digits: number[] = [];
  for (const char of isin) {
    if (char >= "0" && char <= "9") {
      digits.push(char.charCodeAt(0) - 48);
    } else {
      const n = char.charCodeAt(0) - 55; // 'A' (65) → 10
      digits.push(Math.floor(n / 10), n % 10);
    }
  }

  // Standard Luhn: walk the expanded digits right-to-left. The check
  // digit (rightmost) is never doubled; every second digit moving left
  // is doubled, with values > 9 reduced by subtracting 9.
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i]!;
    if (double) {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += d;
    }
    double = !double;
  }

  return sum % 10 === 0;
}
