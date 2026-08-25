import type { ByokKnownService } from "./types";

/**
 * Built-in known service definitions.
 *
 * Other plugins can register additional known services at runtime via
 * {@link registerByokKnownService} so that they appear in the BYOK settings pane.
 */

const ADJACENT_SERVICE: ByokKnownService = {
  id: "adjacent",
  name: "Adjacent Markets",
  apiUrl: "https://api.adjacent.markets",
  authType: "bearer",
  envVar: "ADJACENT_API_KEY",
  description: "Real-time market data and analytics from Adjacent.",
};

const HYPERLIQUID_SERVICE: ByokKnownService = {
  id: "hyperliquid",
  name: "Hyperliquid",
  apiUrl: "https://api.hyperliquid.xyz",
  authType: "none",
  envVar: "HYPERLIQUID_API_KEY",
  description: "Decentralized perp DEX data. Public endpoints need no key; auth key enables private queries.",
};

const SEC_EDGAR_SERVICE: ByokKnownService = {
  id: "sec-edgar",
  name: "SEC EDGAR",
  apiUrl: "https://www.sec.gov",
  authType: "user-agent",
  authKey: "User-Agent",
  envVar: "SEC_EDGAR_EMAIL",
  description: "SEC filings data. Requires an email address in the User-Agent header per SEC fair-access policy.",
};

const ADJACENT_DEV_SERVICE: ByokKnownService = {
  id: "adjacent-dev",
  name: "Adjacent Dev (CFTC)",
  apiUrl: "https://api.dev.adjacent.markets",
  authType: "bearer",
  envVar: "ADJACENT_DEV_API_KEY",
  description: "CFTC filings data via the Adjacent Dev API.",
};

const BUILTIN_SERVICES: ByokKnownService[] = [
  ADJACENT_SERVICE,
  ADJACENT_DEV_SERVICE,
  HYPERLIQUID_SERVICE,
  SEC_EDGAR_SERVICE,
];

const registeredServices = new Map<string, ByokKnownService>(
  BUILTIN_SERVICES.map((service) => [service.id, service]),
);

/** Returns all known services (built-in + registered), sorted by name. */
export function getByokKnownServices(): ByokKnownService[] {
  return [...registeredServices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns a known service by id, or null if not found. */
export function getByokKnownService(serviceId: string): ByokKnownService | null {
  return registeredServices.get(serviceId) ?? null;
}

/**
 * Registers an additional known service so it appears in the BYOK settings pane.
 * Plugins should call this during `setup()` to surface their own API integrations.
 */
export function registerByokKnownService(service: ByokKnownService): void {
  registeredServices.set(service.id, service);
}

/** Options for the "custom" service entry shown in the add-key form. */
export const CUSTOM_SERVICE_OPTION: ByokKnownService = {
  id: "custom",
  name: "Custom API",
  authType: "bearer",
  description: "Any user-defined API endpoint with a key.",
};
