import { colors } from "../../../theme/colors";
import type { MarketState } from "../../../types/financials";

/**
 * Quote-board session indicator: one glyph, colored by whether the session is
 * open, extended, or closed.
 *
 * `marketStateDot`/`marketStateColor` in `src/market-data/market/status.ts`
 * encode the state in the glyph itself and tint extended hours as plain text.
 * Boards need a single dot whose color carries the whole signal, so they share
 * this variant instead.
 */
export function marketStatusDot(state: MarketState | undefined): { char: string; color: string } {
  switch (state) {
    case "REGULAR":
      return { char: "●", color: colors.positive };
    case "PRE":
    case "POST":
    case "PREPRE":
    case "POSTPOST":
      return { char: "●", color: colors.warning };
    case "CLOSED":
    default:
      return { char: "●", color: colors.negative };
  }
}
