import { describe, expect, test } from "bun:test";
import {
  AI_PROVIDER_IDS,
  getAiProvider,
  getAiProviderDefinitions,
  migrateLegacyAiProviderId,
  resolveDefaultAiProviderId,
  setDetectedProviders,
} from "./providers";
import {
  GLOOMBERB_PI_PROVIDER_FACTORIES,
  GLOOMBERB_PI_PROVIDER_IDS,
} from "./pi/providers";

describe("Pi provider catalog", () => {
  test("exposes exactly the curated canonical providers in a stable order", () => {
    expect(AI_PROVIDER_IDS).toEqual([
      "browser-builtin",
      "ollama",
      "anthropic",
      "openai-codex",
      "openai",
      "google",
      "github-copilot",
      "xai",
      "openrouter",
    ]);
    expect(GLOOMBERB_PI_PROVIDER_IDS).toEqual(AI_PROVIDER_IDS.filter((id) => id !== "browser-builtin" && id !== "ollama"));
    expect(new Set(AI_PROVIDER_IDS).size).toBe(AI_PROVIDER_IDS.length);
    expect(AI_PROVIDER_IDS).not.toContain("opencode");
    expect(AI_PROVIDER_IDS).not.toContain("pi");
  });

  test("keeps UI metadata and curated defaults aligned with Pi models", () => {
    const definitions = getAiProviderDefinitions();
    const piProviders = GLOOMBERB_PI_PROVIDER_FACTORIES.map((createProvider) => createProvider());

    expect(definitions.map((provider) => provider.id)).toEqual([...AI_PROVIDER_IDS]);
    for (const definition of definitions) {
      const provider = piProviders.find((candidate) => candidate.id === definition.id);
      if (definition.id === "browser-builtin" || definition.id === "ollama") {
        expect(definition.outputModes).toEqual(["plain"]);
        continue;
      }
      expect(provider).toBeDefined();
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.outputModes).toEqual(["plain", "structured", "screener"]);
      expect(definition.preferredModelIds.length).toBeGreaterThan(0);
      expect(provider?.getModels().some((model) => (
        definition.preferredModelIds.includes(model.id)
      ))).toBe(true);
      expect(definition).not.toHaveProperty("command");
      expect(definition).not.toHaveProperty("buildArgs");
    }
  });

  test("uses the browser provider only as the hosted web default", () => {
    Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
    const browser = {
      id: "browser-builtin" as const,
      name: "Browser (on-device)",
      available: true,
      status: "ready" as const,
      outputModes: ["plain" as const],
    };
    const remote = {
      id: "anthropic" as const,
      name: "Claude",
      available: true,
      status: "ready" as const,
      outputModes: ["plain" as const],
    };
    expect(resolveDefaultAiProviderId([remote, browser])).toBe("browser-builtin");
    expect(resolveDefaultAiProviderId([{ ...browser, status: "check_failed", available: false }, remote])).toBe("anthropic");
  });

  test("uses legacy ids only to migrate persisted selections", () => {
    expect(migrateLegacyAiProviderId("claude")).toBe("anthropic");
    expect(migrateLegacyAiProviderId("codex")).toBe("openai-codex");
    expect(migrateLegacyAiProviderId("gemini")).toBe("google");
    expect(migrateLegacyAiProviderId("openai")).toBe("openai");
    expect(migrateLegacyAiProviderId("opencode")).toBe("opencode");

    setDetectedProviders(getAiProviderDefinitions().map((definition) => ({
      id: definition.id,
      name: definition.name,
      available: false,
      status: "not_authenticated",
      outputModes: [...definition.outputModes],
    })));
    expect(getAiProvider("claude")?.id).toBe("anthropic");
    expect(getAiProvider("codex")?.id).toBe("openai-codex");
    setDetectedProviders(null);
  });
});
