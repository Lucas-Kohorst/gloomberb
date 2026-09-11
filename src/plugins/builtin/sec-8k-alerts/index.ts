import type { GloomPlugin, AlertEvaluationInput } from "../../../types/plugin";
import type { SecFilingItem } from "../../../types/data-provider";
import { SecEdgarClient } from "../../../sources/sec-edgar";
import { registerConnectionSource, withConnectionRequest } from "../connections/register";

export const SEC_8K_ALERTS_PLUGIN_ID = "sec-8k-alerts";
export const SEC_8K_ALERTS_CONNECTION_ID = "sec-8k-alerts";
export const SEC_8K_ALERT_CONDITION_ID = "sec-8k-filed";

/** How many recent submissions to scan per poll. Polls run often, so this only needs to cover filings since the last check. */
const RECENT_FILINGS_LIMIT = 15;

const sharedEdgarClient = new SecEdgarClient();

export type Sec8KListFn = (symbol: string, signal: AbortSignal) => Promise<SecFilingItem[]>;

/**
 * Last seen 8-K per upper-cased symbol. This is the alert state: `evaluate`
 * baselines on first sight and only returns true when a poll observes a
 * strictly newer filing than the previous poll. Older-only polls neither
 * fire nor move the watermark backwards.
 */
interface Seen8K {
  accessionNumber: string;
  filedAt: number;
  acceptedAt: number;
}

const seen8KAccessionBySymbol = new Map<string, Seen8K>();

export function resetSec8KAlertState(): void {
  seen8KAccessionBySymbol.clear();
}

function defaultListRecentFilings(symbol: string): Promise<SecFilingItem[]> {
  return withConnectionRequest(SEC_8K_ALERTS_CONNECTION_ID, "poll-8k", () =>
    sharedEdgarClient.getRecentFilings(symbol, RECENT_FILINGS_LIMIT),
  );
}

export function is8KForm(form: string): boolean {
  return /^8-K(\/A)?$/i.test(form.trim());
}

function matchesItemFilter(filing: SecFilingItem, filter: string): boolean {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return true;
  return (filing.items ?? "").toLowerCase().includes(normalized);
}

function filingRank(filing: SecFilingItem): Seen8K {
  return {
    accessionNumber: filing.accessionNumber,
    filedAt: filing.filingDate.getTime(),
    acceptedAt: filing.acceptedAt?.getTime() ?? 0,
  };
}

function compareRanks(left: Seen8K, right: Seen8K): number {
  return (
    left.filedAt - right.filedAt
    || left.acceptedAt - right.acceptedAt
    || (left.accessionNumber < right.accessionNumber
      ? -1
      : left.accessionNumber > right.accessionNumber ? 1 : 0)
  );
}

function pickLatestFilingsFirst(filings: SecFilingItem[]): SecFilingItem | null {
  let latest: SecFilingItem | null = null;
  let latestRank: Seen8K | null = null;
  for (const filing of filings) {
    const rank = filingRank(filing);
    if (!latest || !latestRank || compareRanks(rank, latestRank) > 0) {
      latest = filing;
      latestRank = rank;
    }
  }
  return latest;
}

export async function evaluateSec8KAlert(
  alert: AlertEvaluationInput,
  signal: AbortSignal,
  listRecentFilings: Sec8KListFn = defaultListRecentFilings,
): Promise<boolean> {
  const symbol = alert.symbol.trim().toUpperCase();
  if (!symbol || signal.aborted) return false;

  const filings = await listRecentFilings(symbol, signal);
  if (signal.aborted) return false;

  const filter = alert.targetText?.trim() ?? "";
  const eights = filings.filter((filing) => is8KForm(filing.form) && matchesItemFilter(filing, filter));
  if (eights.length === 0) return false;

  const latest = pickLatestFilingsFirst(eights);
  if (!latest) return false;

  const rank = filingRank(latest);
  const previous = seen8KAccessionBySymbol.get(symbol);
  if (previous === undefined) {
    // First sighting baselines the alert so creating it never fires on history.
    seen8KAccessionBySymbol.set(symbol, rank);
    return false;
  }
  if (compareRanks(rank, previous) <= 0) return false;

  seen8KAccessionBySymbol.set(symbol, rank);
  return true;
}

export function formatSec8KAlertDescription(alert: AlertEvaluationInput): string {
  const symbol = alert.symbol.trim().toUpperCase();
  const filter = alert.targetText?.trim();
  return filter ? `${symbol} 8-K filed (item ${filter})` : `${symbol} 8-K filed`;
}

let disposeConnection: (() => void) | null = null;

export const sec8KAlertsPlugin: GloomPlugin = {
  id: SEC_8K_ALERTS_PLUGIN_ID,
  name: "SEC 8-K Alerts",
  version: "1.0.0",
  description: "Alert condition that triggers when a symbol files a new 8-K with SEC EDGAR.",
  toggleable: true,

  setup(ctx) {
    disposeConnection = registerConnectionSource({
      id: SEC_8K_ALERTS_CONNECTION_ID,
      name: "SEC 8-K Alerts",
      kind: "api",
      pluginId: SEC_8K_ALERTS_PLUGIN_ID,
      authRequired: false,
    });
    ctx.registerAlertCondition({
      id: SEC_8K_ALERT_CONDITION_ID,
      label: "8-K filed",
      description: "Trigger when the symbol files a new 8-K with SEC EDGAR.",
      targetType: "text",
      targetLabel: "Item filter (optional)",
      targetPlaceholder: "blank for any 8-K, e.g. 2.02",
      evaluate: (alert, signal) => evaluateSec8KAlert(alert, signal),
      formatDescription: formatSec8KAlertDescription,
    });
  },

  dispose() {
    // The registry removes this plugin's alert condition on unregister;
    // here we release the connection source and the in-memory seen-state.
    disposeConnection?.();
    disposeConnection = null;
    resetSec8KAlertState();
  },
};

export default sec8KAlertsPlugin;
