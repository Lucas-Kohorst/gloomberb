import { describe, expect, test } from "bun:test";
import { createDefaultConfig, type AppConfig, type BrokerInstanceConfig } from "../types/config";
import { REDACTED, hydrateRedactedConfigForRemote, redactConfigForRemote } from "./redact-config";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../plugins/builtin/byok/types";

// Obviously-fake sentinels defined by the test itself. Never real credentials.
const BROKER_TOKEN = "BROKER_SECRET_TOKEN_xyz123";
const BROKER_REFRESH = "BROKER_REFRESH_sentinel_456";
const BYOK_KEY = "sk-byok-sentinel-abc789";
const BYOK_SPEC_BODY = "openapi-spec-body-may-embed-tokens-789";

function buildConfigWithSecrets(): AppConfig {
  const config = createDefaultConfig("/tmp/gloom-redact-config-test");
  config.brokerInstances = [
    {
      id: "broker-1",
      brokerType: "ibkr",
      label: "Main IBKR",
      connectionMode: "live",
      enabled: true,
      lastSyncedAt: 1700000000000,
      config: {
        token: BROKER_TOKEN,
        refreshToken: BROKER_REFRESH,
        nested: { accountId: "U12345", session: "session-secret" },
      },
    },
  ];
  config.pluginConfig = {
    [BYOK_PLUGIN_ID]: {
      [BYOK_API_KEYS_CONFIG_KEY]: {
        keys: [
          {
            id: "byok-1",
            serviceId: "fred",
            name: "FRED key",
            apiKey: BYOK_KEY,
            apiUrl: "https://api.stlouisfed.org",
            createdAt: 1700000000000,
            lastValidated: 1700000001000,
            lastValidationStatus: "ok",
            openApiSpecBody: BYOK_SPEC_BODY,
          },
        ],
      },
    },
  };
  return config;
}

describe("redactConfigForRemote", () => {
  test("redacts broker credential values while preserving keys and identity", () => {
    const redacted = redactConfigForRemote(buildConfigWithSecrets());
    const broker = redacted.brokerInstances[0] as BrokerInstanceConfig;

    // Identity and non-secret metadata survive.
    expect(broker.id).toBe("broker-1");
    expect(broker.brokerType).toBe("ibkr");
    expect(broker.label).toBe("Main IBKR");
    expect(broker.connectionMode).toBe("live");
    expect(broker.enabled).toBe(true);
    expect(broker.lastSyncedAt).toBe(1700000000000);

    // Every credential value is replaced while keys (presence) are preserved.
    expect(broker.config.token).toBe(REDACTED);
    expect(broker.config.refreshToken).toBe(REDACTED);
    expect(Object.keys(broker.config).sort()).toEqual(
      ["nested", "refreshToken", "token"].sort(),
    );
    // Nested credential material is also redacted.
    expect(JSON.stringify(broker.config)).not.toContain(BROKER_TOKEN);
    expect(JSON.stringify(broker.config)).not.toContain(BROKER_REFRESH);
  });

  test("redacts BYOK api keys while preserving identity and validation metadata", () => {
    const redacted = redactConfigForRemote(buildConfigWithSecrets());
    const byok = (redacted.pluginConfig[BYOK_PLUGIN_ID] as Record<string, unknown>)[
      BYOK_API_KEYS_CONFIG_KEY
    ] as { keys: Record<string, unknown>[] };
    const entry = byok.keys[0];

    // Non-secret identity/metadata survives.
    expect(entry.id).toBe("byok-1");
    expect(entry.serviceId).toBe("fred");
    expect(entry.name).toBe("FRED key");
    expect(entry.apiUrl).toBe("https://api.stlouisfed.org");
    expect(entry.createdAt).toBe(1700000000000);
    expect(entry.lastValidated).toBe(1700000001000);
    expect(entry.lastValidationStatus).toBe("ok");

    // The credential and opaque blob are redacted.
    expect(entry.apiKey).toBe(REDACTED);
    expect(entry.openApiSpecBody).toBe(REDACTED);
    expect(JSON.stringify(redacted)).not.toContain(BYOK_KEY);
    expect(JSON.stringify(redacted)).not.toContain(BYOK_SPEC_BODY);
  });

  test("does not mutate the live config", () => {
    const config = buildConfigWithSecrets();
    const original = JSON.stringify(config);
    redactConfigForRemote(config);
    expect(JSON.stringify(config)).toBe(original);
    // Live broker config still holds the raw sentinel.
    expect((config.brokerInstances[0].config as Record<string, unknown>).token).toBe(
      BROKER_TOKEN,
    );
  });

  test("hydrates redacted markers back to live credentials without touching real writes", () => {
    const live = buildConfigWithSecrets();
    // A consumer that read the redacted view and round-trips it: every field
    // the redactor touched is the marker, everything else is the tweaked value.
    const redacted = redactConfigForRemote(live);
    (redacted.pluginConfig[BYOK_PLUGIN_ID] as Record<string, unknown>)[
      BYOK_API_KEYS_CONFIG_KEY
    ] = {
      keys: [
        {
          id: "byok-1",
          serviceId: "fred",
          name: "Renamed FRED key",
          apiKey: REDACTED,
          openApiSpecBody: REDACTED,
          createdAt: 1700000000000,
        },
      ],
    };
    const broker = redacted.brokerInstances[0];
    broker.label = "Renamed label";
    broker.config = { ...broker.config, token: REDACTED, refreshToken: REDACTED };

    const hydrated = hydrateRedactedConfigForRemote(live, redacted);

    // Credentials are restored from the live config...
    expect(hydrated.brokerInstances[0].config.token).toBe(BROKER_TOKEN);
    expect(hydrated.brokerInstances[0].config.refreshToken).toBe(BROKER_REFRESH);
    const byok = (hydrated.pluginConfig[BYOK_PLUGIN_ID] as Record<string, unknown>)[
      BYOK_API_KEYS_CONFIG_KEY
    ] as { keys: Record<string, unknown>[] };
    expect(byok.keys[0].apiKey).toBe(BYOK_KEY);
    expect(byok.keys[0].openApiSpecBody).toBe(BYOK_SPEC_BODY);
    // ...while the consumer's real edits are preserved.
    expect(hydrated.brokerInstances[0].label).toBe("Renamed label");
    expect(byok.keys[0].name).toBe("Renamed FRED key");
    // The live config is untouched and neither input is mutated.
    expect(live.brokerInstances[0].config.token).toBe(BROKER_TOKEN);
    expect(redacted.brokerInstances[0].config.token).toBe(REDACTED);
  });

  test("hydrate leaves real writes alone and ignores unknown live entries", () => {
    const live = buildConfigWithSecrets();
    const incoming = structuredClone(live) as AppConfig;
    incoming.brokerInstances[0].config = {
      ...incoming.brokerInstances[0].config,
      token: "new-real-token",
    };
    incoming.brokerInstances.push({
      id: "broker-new",
      brokerType: "ibkr",
      label: "New broker",
      config: { token: REDACTED },
    });

    const hydrated = hydrateRedactedConfigForRemote(live, incoming);

    // A real write passes through untouched.
    expect(hydrated.brokerInstances[0].config.token).toBe("new-real-token");
    expect(hydrated.brokerInstances[0].config.refreshToken).toBe(BROKER_REFRESH);
    // An entry with no live counterpart keeps its marker.
    expect(hydrated.brokerInstances[1].config.token).toBe(REDACTED);
  });
});
