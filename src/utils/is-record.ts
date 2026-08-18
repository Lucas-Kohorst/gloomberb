/** Narrow unknown JSON-like values to plain objects (not arrays/null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
