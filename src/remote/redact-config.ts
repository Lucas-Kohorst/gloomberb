import type { AppConfig, BrokerInstanceConfig } from "../types/config";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../plugins/builtin/byok/types";

/**
 * Stable placeholder substituted for every redacted secret value. Preserving
 * the key (and therefore the value's presence/shape) lets a remote consumer
 * assert "this broker has credentials configured" without seeing them.
 */
export const REDACTED = "[redacted]";

/**
 * Non-secret identity and metadata fields on a broker instance that survive
 * redaction. Everything in `BrokerInstanceConfig.config` is treated as
 * credential material and replaced wholesale (see {@link redactBrokerInstance}).
 */
const SAFE_BROKER_FIELDS = new Set<keyof BrokerInstanceConfig>([
  "id",
  "brokerType",
  "label",
  "connectionMode",
  "enabled",
  "lastSyncedAt",
]);

/**
 * Non-secret fields preserved on a BYOK API-key entry. This is an explicit
 * allowlist: any field not listed here (including future additions) is
 * redacted, so a newly introduced secret field is never silently exposed.
 * `apiKey` is the documented credential; `openApiSpecBody` is an opaque
 * user-supplied blob that may embed tokens and is redacted defensively.
 */
const SAFE_BYOK_ENTRY_FIELDS = new Set<string>([
  "id",
  "serviceId",
  "name",
  "apiUrl",
  "dataFormat",
  "openApiSpecUrl",
  "openApiAuthType",
  "openApiAuthKey",
  "openApiOperations",
  "createdAt",
  "lastValidated",
  "lastValidationStatus",
]);

/** Replace every value in a broker's `config` record with the redaction marker, preserving keys. */
function redactBrokerConfig(config: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const key of Object.keys(config)) redacted[key] = REDACTED;
  return redacted;
}

/** Redact a single broker instance, preserving identity and non-secret metadata. */
function redactBrokerInstance(broker: BrokerInstanceConfig): BrokerInstanceConfig {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(broker) as (keyof BrokerInstanceConfig)[]) {
    if (key === "config") {
      result[key] = redactBrokerConfig(broker.config);
    } else if (SAFE_BROKER_FIELDS.has(key)) {
      result[key] = broker[key];
    } else {
      // Unknown future field: redact defensively rather than leak it.
      result[key] = REDACTED;
    }
  }
  return result as unknown as BrokerInstanceConfig;
}

/**
 * Redact a BYOK API-key entry using an explicit allowlist of safe fields.
 * Any field not in the allowlist (including `apiKey` and future additions)
 * is replaced with the redaction marker, preserving presence and shape.
 */
function redactByokEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const key of Object.keys(entry)) {
    redacted[key] = SAFE_BYOK_ENTRY_FIELDS.has(key) ? entry[key] : REDACTED;
  }
  return redacted;
}

/**
 * Redact credential material from an app config before it leaves the remote
 * control surface. Returns a deep clone; the live config is never mutated and
 * the result never aliases it.
 *
 * Redaction policy:
 * - `brokerInstances[].config` is entirely credential material; every value
 *   is replaced with {@link REDACTED} while keys (presence) are preserved.
 *   Broker identity (`id`, `brokerType`, `label`, ...) is kept.
 * - The BYOK API-key store under
 *   `pluginConfig["application"]["byokApiKeys"]` has each entry's non-allowlisted
 *   fields (notably `apiKey`) replaced with {@link REDACTED}; identity and
 *   validation metadata survive.
 *
 * Maintenance: this is an allowlist. When `BrokerInstanceConfig` or
 * `ByokApiKeyEntry` gains a new field, decide whether it is secret and, if it
 * is, ensure it is NOT added to the safe-field sets above.
 */
export function redactConfigForRemote(config: AppConfig): AppConfig {
  const clone = structuredClone(config) as AppConfig;

  if (Array.isArray(clone.brokerInstances)) {
    clone.brokerInstances = clone.brokerInstances.map(redactBrokerInstance);
  }

  const appPluginConfig = clone.pluginConfig?.[BYOK_PLUGIN_ID];
  if (appPluginConfig && typeof appPluginConfig === "object") {
    const byokEntry = (appPluginConfig as Record<string, unknown>)[BYOK_API_KEYS_CONFIG_KEY];
    if (byokEntry && typeof byokEntry === "object") {
      const byokConfig = byokEntry as { keys?: unknown[] };
      if (Array.isArray(byokConfig.keys)) {
        byokConfig.keys = byokConfig.keys.map((entry) =>
          redactByokEntry(entry as Record<string, unknown>),
        );
      }
    }
  }

  return clone;
}
