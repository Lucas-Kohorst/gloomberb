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

const BUILTIN_SERVICES: ByokKnownService[] = [
  ADJACENT_SERVICE,
  HYPERLIQUID_SERVICE,
  SEC_EDGAR_SERVICE,
];

const registeredServices = new Map<string, ByokKnownService>(
  BUILTIN_SERVICES.map((service) => [service.id, service]),
);

const listeners = new Set<() => void>();
let servicesVersion = 0;

function notifyByokKnownServices(): void {
  servicesVersion += 1;
  for (const listener of listeners) listener();
}

export function getByokKnownServicesVersion(): number {
  return servicesVersion;
}

/** Returns all known services (built-in + registered), sorted by name. */
export function getByokKnownServices(): ByokKnownService[] {
  return [...registeredServices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns a known service by id, or null if not found. */
export function getByokKnownService(serviceId: string): ByokKnownService | null {
  return registeredServices.get(serviceId) ?? null;
}

/**
 * Registers an additional known service so it appears in ACM Keys and the
 * BYOK settings pane. Returns a disposer that withdraws this registration.
 * Plugins should call {@link GloomPluginContext.registerByokService} instead
 * so the owning plugin id is stamped automatically.
 */
export function registerByokKnownService(service: ByokKnownService): () => void {
  const id = service.id.trim();
  if (!id) return () => {};
  const entry: ByokKnownService = { ...service, id };
  registeredServices.set(id, entry);
  notifyByokKnownServices();
  return () => {
    if (registeredServices.get(id) !== entry) return;
    registeredServices.delete(id);
    notifyByokKnownServices();
  };
}

/** Subscribe to plugin BYOK service registrations. */
export function subscribeByokKnownServices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Options for the "custom" service entry shown in the add-key form. */
export const CUSTOM_SERVICE_OPTION: ByokKnownService = {
  id: "custom",
  name: "Custom API",
  authType: "bearer",
  description: "Any user-defined API endpoint with a key.",
};
