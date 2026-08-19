import { loadNwsCliPrints } from "../../../sources/nws-cli/load";
import { normalizeIcaoStation } from "../../../sources/nws-cli/parse";
import type { KeyedDataProvider, ProviderPlan } from "./types";
import { NWS_CLI_USER_AGENT } from "../../../sources/nws-cli/types";

function utcDateKey(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? value : null;
}

export const nwsCliProvider: KeyedDataProvider = {
  id: "nws-cli",
  name: "NWS Daily Climate Report (CLI)",
  ttlSeconds: 15 * 60,
  userAgent: NWS_CLI_USER_AGENT,
  resolve({ keyPath, search }): ProviderPlan {
    const icao = normalizeIcaoStation(keyPath.split("/")[0] ?? "");
    if (!icao) {
      return { kind: "error", status: 400, error: "ICAO station is required (e.g. KNYC)." };
    }
    const dateRaw = search.get("date");
    const date = dateRaw ? utcDateKey(dateRaw) : null;
    if (dateRaw && !date) {
      return { kind: "error", status: 400, error: "date must be YYYY-MM-DD." };
    }
    const daysRaw = search.get("days");
    const days = daysRaw ? Number(daysRaw) : undefined;
    if (daysRaw && (!Number.isFinite(days) || (days ?? 0) < 1)) {
      return { kind: "error", status: 400, error: "days must be a positive integer." };
    }
    const cacheKey = `nws-cli:${icao}:${date ?? ""}:${days ?? ""}`;
    return {
      kind: "print",
      cacheKey,
      load: async (fetchImpl) => {
        const set = await loadNwsCliPrints({
          icao,
          date: date ?? undefined,
          days,
          fetchImpl,
          userAgent: NWS_CLI_USER_AGENT,
        });
        if (set.prints.length === 0) {
          const error = new Error(date
            ? `No final NWS CLI print for ${icao} on ${date}.`
            : `No final NWS CLI print for ${icao}.`);
          (error as Error & { status?: number }).status = 404;
          throw error;
        }
        if (days) return set;
        return set.prints[0];
      },
    };
  },
};
