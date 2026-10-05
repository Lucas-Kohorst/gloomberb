import { resolveInstrumentForPane } from "../../core/state/app/instrument";
import { resolveTickerForPane, type AppState } from "../../state/app/context";
import { t } from "../../i18n";
import { tickerInstrumentLabel } from "../../tickers/instrument-label";

/** The focused pane's instrument, in the same words a pane title uses for a contract. */
export function activeCommandInstrumentLabel(state: AppState): string | null {
  if (!state.focusedPaneId) return null;
  const symbol = resolveTickerForPane(state, state.focusedPaneId);
  if (!symbol) return null;
  return tickerInstrumentLabel(symbol, resolveInstrumentForPane(state, state.focusedPaneId)?.instrument);
}

/** Root prompt text. A selected instrument stands in for the search hint. */
export function rootCommandPlaceholder(instrumentLabel: string | null): string {
  return instrumentLabel ?? t("Search or run a command");
}
