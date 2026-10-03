/**
 * Legacy BYOK (Bring Your Own Key) config schema.
 *
 * The BYOK plugin is gone, but existing installs and synced snapshots still
 * carry `pluginConfig["application"].byokApiKeys`. These constants and types
 * only describe that persisted data so config hygiene keeps working: keys are
 * stripped before server-side snapshots, redacted before logs/remote payloads,
 * and preserved against a cloud pull. Nothing here stores, reads, or serves a
 * key at runtime — plugins that once resolved keys now fall back to their own
 * environment variables.
 */

export type ByokAuthType = "bearer" | "header" | "query" | "user-agent" | "none";

export type ByokDataFormat = "json" | "csv" | "text" | "auto";

/** A known service that the app or its plugins could take an API key for. */
export interface ByokKnownService {
  /** Stable identifier historically used by `ctx.getApiKey(serviceId)`. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Base API URL for the service. */
  apiUrl?: string;
  /** How the key was transmitted in requests. */
  authType: ByokAuthType;
  /** Header or query parameter name when authType is "header" or "query". */
  authKey?: string;
  /** Environment variable checked as a fallback for hosted/CLI usage. */
  envVar?: string;
  /** Optional prefix to help users identify the key (e.g. "sk-"). */
  keyPrefix?: string;
  /** Short description of what the service provides. */
  description: string;
  /** Owning plugin id when registered from `ctx.registerByokService`. */
  pluginId?: string;
}

/** A stored API key entry. */
export interface ByokApiKeyEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** Matches a known service id, or "custom" for user-defined APIs. */
  serviceId: string;
  /** User-supplied label for this key. */
  name: string;
  /** The actual API key or credential value (e.g. email for SEC EDGAR). */
  apiKey: string;
  /** API URL for custom services; may override the known service default. */
  apiUrl?: string;
  /** Data format hint for custom APIs. */
  dataFormat?: ByokDataFormat;
  /** Optional OpenAPI/Swagger description used to direct custom API tests. */
  openApiSpecUrl?: string;
  openApiSpecBody?: string;
  openApiAuthType?: ByokAuthType;
  openApiAuthKey?: string;
  openApiOperations?: ByokOpenApiOperation[];
  /** When the entry was created (epoch ms). */
  createdAt: number;
  /** When the key was last validated (epoch ms), if ever. */
  lastValidated?: number;
  /** Result of the last validation attempt. */
  lastValidationStatus?: "ok" | "error" | "untested";
}

export interface ByokOpenApiOperation {
  method: "GET";
  path: string;
  summary?: string;
  tags?: string[];
  probeUrl?: string;
}

/** Shape persisted under the application plugin's config namespace. */
export interface ByokStoredConfig {
  keys: ByokApiKeyEntry[];
}

export const BYOK_CUSTOM_SERVICE_ID = "custom";
export const BYOK_API_KEYS_CONFIG_KEY = "byokApiKeys";

/** The plugin id that historically owned BYOK config state. */
export const BYOK_PLUGIN_ID = "application";

/**
 * localStorage blob that once held a user's encrypted keys. Nothing writes it
 * any more; the key is kept so a workspace wipe still deletes old key material.
 */
export const HOSTED_BYOK_STORAGE_KEY = "gloomberb:hosted-byok-keys";

export function hostedByokStorageKey(userId: string): string {
  return `${HOSTED_BYOK_STORAGE_KEY}:${userId}`;
}

/**
 * Advertising a BYOK service no longer does anything: there is no key vault
 * left to register into. Kept so plugins declaring services keep loading.
 */
export function registerByokKnownService(service: ByokKnownService): () => void {
  void service;
  return () => {};
}
