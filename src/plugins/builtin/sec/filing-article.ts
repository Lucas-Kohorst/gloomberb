import type { PaneRuntimeState } from "../../../core/state/app/state";
import { setPluginPaneStateValue } from "../../../layout/pane-state";
import { instrumentFromTicker } from "../../../market-data/request-types";
import type { SecFilingItem } from "../../../types/data-provider";
import type { PaneTemplateCreateOptions } from "../../../types/plugin";
import type { TickerRecord } from "../../../types/ticker";
import { scopedBrokerContractIdentityKey } from "../../../utils/instrument-identity";
import { isUsEquityTicker } from "../../../utils/sec";
import { tickerResearchPluginMeta } from "../builtin-plugin-meta";

const SEC_TEMPLATE_ID = "sec-pane";

const secPaneInstanceId = (symbol: string, ticker: TickerRecord): string => {
  const base = `sec:${encodeURIComponent(symbol.trim().toUpperCase()).replace(/%/g, "~")}`;
  const contract = instrumentFromTicker(ticker)?.instrument;
  return contract
    ? `${base}:${encodeURIComponent(scopedBrokerContractIdentityKey(contract))}`
    : base;
};

export const filingDocumentUrl = (filing: SecFilingItem): string => (
  filing.primaryDocumentUrl || filing.filingUrl
);

export const openSecFiling = (options: {
  filing: SecFilingItem;
  ticker: string;
  createPaneFromTemplate: (templateId: string, createOptions?: PaneTemplateCreateOptions) => void;
  getTicker: (symbol: string) => TickerRecord | null;
  getPaneRuntimeState: (paneId: string) => PaneRuntimeState | null;
  updatePaneRuntimeState: (paneId: string, patch: Partial<PaneRuntimeState>) => void;
  openExternal: (url: string) => void | Promise<void>;
}): void => {
  const symbol = options.ticker.trim().toUpperCase();
  const saved = symbol ? options.getTicker(symbol) : null;
  const tickerKey = saved?.metadata.ticker || "";
  if (saved && tickerKey && isUsEquityTicker(saved)) {
    const paneId = secPaneInstanceId(tickerKey, saved);
    // The filings pane restores the open document from this key.
    const pluginState = setPluginPaneStateValue(
      options.getPaneRuntimeState(paneId) ?? undefined,
      tickerResearchPluginMeta.id,
      `openAccession:${tickerKey}`,
      options.filing.accessionNumber,
    );
    options.updatePaneRuntimeState(paneId, { pluginState });
    options.createPaneFromTemplate(SEC_TEMPLATE_ID, { symbol: tickerKey, ticker: saved });
    return;
  }
  const url = filingDocumentUrl(options.filing);
  if (url) void options.openExternal(url);
};
