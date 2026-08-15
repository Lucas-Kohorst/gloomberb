/**
 * Types for the BYOK (Bring Your Own Key) settings system.
 *
 * API keys are stored in the application plugin's config namespace and are
 * never written to AppConfig top-level fields. Other plugins retrieve keys
 * at runtime via {@link GloomPluginContext.getApiKey}.
 */

export type ByokAuthType = "bearer" | "header" | "query" | "user-agent" | "none";

export type ByokDataFormat = "json" | "csv" | "text" | "auto";

/** A known service that the app or its plugins can use API keys for. */
export interface ByokKnownService {
  /** Stable identifier used by `ctx.getApiKey(serviceId)`. */
  id: string;
  /** Human-readable name shown in the settings pane. */
  name: string;
  /** Base API URL for the service (optional for services like SEC EDGAR). */
  apiUrl?: string;
  /** How the key is transmitted in requests. */
  authType: ByokAuthType;
  /** Header or query parameter name when authType is "header" or "query". */
  authKey?: string;
  /** Environment variable checked as a fallback for hosted/CLI usage. */
  envVar?: string;
  /** Optional prefix to help users identify the key (e.g. "sk-"). */
  keyPrefix?: string;
  /** Short description of what the service provides. */
  description: string;
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
  /** When the entry was created (epoch ms). */
  createdAt: number;
  /** When the key was last validated (epoch ms), if ever. */
  lastValidated?: number;
  /** Result of the last validation attempt. */
  lastValidationStatus?: "ok" | "error" | "untested";
}

/** Shape persisted under the application plugin's config namespace. */
export interface ByokStoredConfig {
  keys: ByokApiKeyEntry[];
}

export const BYOK_CUSTOM_SERVICE_ID = "custom";
export const BYOK_API_KEYS_CONFIG_KEY = "byokApiKeys";

/** The plugin id that owns BYOK config state (the application composite plugin). */
export const BYOK_PLUGIN_ID = "application";
