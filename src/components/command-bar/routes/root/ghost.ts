/**
 * The grey tail of an inferred shortcut. Typed characters stay as typed.
 * `displayTicker` is the prompt's own name for that instrument, so the hint
 * matches the ticker already sitting in the empty prompt.
 */
export function shortcutGhostSuffix(
  query: string,
  completion: string | null,
  options?: { displayTicker?: string | null },
): string | null {
  if (!completion || query.length > completion.length) return null;
  if (completion.slice(0, query.length).toUpperCase() !== query.toUpperCase()) return null;
  const rest = completion.slice(query.length);
  if (!rest) return null;
  const space = completion.indexOf(" ");
  const symbol = space >= 0 ? completion.slice(space + 1) : "";
  const label = options?.displayTicker?.trim();
  if (!label || !symbol || label.toUpperCase() === symbol.toUpperCase()) return rest;
  if (!rest.toUpperCase().endsWith(symbol.toUpperCase())) return rest;
  return `${rest.slice(0, rest.length - symbol.length)}${label}`;
}
