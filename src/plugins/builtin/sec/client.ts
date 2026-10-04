import { SecEdgarClient } from "../../../sources/sec-edgar";
import type {
  DataProvider,
  MarketDataRequestContext,
  SecFilingItem,
} from "../../../types/data-provider";
import { normalizeFilingForm } from "./forms";

const edgar = new SecEdgarClient();

function filingForms(forms: readonly string[] | undefined): string[] | null {
  if (!forms || forms.length === 0) return null;
  const normalized = forms.map((form) => normalizeFilingForm(form)).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

export async function loadSecFilings(
  provider: DataProvider | null,
  symbol: string,
  count: number,
  exchange = "",
  context?: MarketDataRequestContext,
  options?: { forms?: readonly string[] },
): Promise<SecFilingItem[]> {
  // A form list is an EDGAR submissions query. Leaving it off keeps the provider feed.
  const forms = filingForms(options?.forms);
  if (forms) return edgar.getRecentFilings(symbol, count, { forms });
  if (!provider?.getSecFilings) throw new Error("SEC filing data unavailable");
  return provider.getSecFilings(symbol, count, exchange, context);
}
