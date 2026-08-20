import type { KeyedDataProvider, ProviderPlan } from "./types";
import { TWC_KALSHI_USER_AGENT } from "./types";

const TWC_ORIGIN = "https://weather.com";
const ALLOWED_PREFIX = "/kalshi/api/";

export const twcKalshiProvider: KeyedDataProvider = {
  id: "twc-kalshi",
  name: "The Weather Company (Kalshi hourly / climate)",
  ttlSeconds: 60,
  userAgent: TWC_KALSHI_USER_AGENT,
  resolve({ keyPath, search }): ProviderPlan {
    const path = `/${keyPath}`;
    if (!path.startsWith(ALLOWED_PREFIX)) {
      return { kind: "error", status: 404, error: "Not found" };
    }
    let target: URL;
    try {
      target = new URL(`${TWC_ORIGIN}${path}${search.size ? `?${search.toString()}` : ""}`);
    } catch {
      return { kind: "error", status: 400, error: "Invalid upstream URL" };
    }
    if (target.hostname !== "weather.com" || !target.pathname.startsWith(ALLOWED_PREFIX)) {
      return { kind: "error", status: 404, error: "Not found" };
    }
    return { kind: "proxy", url: target.toString() };
  },
};
