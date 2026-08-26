import { isHostedWebClient } from "../../../shared/hosted-api";
import type { AiRunOutputMode, AiRuntimeProvider } from "./runner";

export const AI_PROVIDER_IDS = [
  "browser-builtin",
  "ollama",
  "anthropic",
  "openai-codex",
  "openai",
  "google",
  "github-copilot",
  "xai",
  "openrouter",
  "deepseek",
  "groq",
  "cerebras",
  "mistral",
  "together",
  "fireworks",
  "amazon-bedrock",
  "google-vertex",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/**
 * These aliases exist only to migrate persisted pre-Pi selections. Runtime
 * catalogs and requests always use the canonical Pi provider ids above.
 */
const LEGACY_AI_PROVIDER_ID_ALIASES = {
  claude: "anthropic",
  codex: "openai-codex",
  gemini: "google",
} as const satisfies Readonly<Record<string, AiProviderId>>;

export type AiProviderStatus = "ready" | "not_authenticated" | "check_failed";

export interface AiProviderDefinition {
  id: AiProviderId;
  name: string;
  outputModes: readonly AiRunOutputMode[];
  /**
   * Ordered, curated defaults. The runtime chooses the first one available to
   * the connected account and never falls back to provider array order.
   * Ordered quality-first (powerful → balanced → fast).
   */
  preferredModelIds: readonly string[];
  /**
   * Ordered fast/cheap defaults for speed-optimised features (e.g. the
   * screener). The runtime chooses the first one available to the connected
   * account. Ordered speed-first (fast → balanced).
   */
  fastModelIds: readonly string[];
}

export interface AiProvider {
  id: AiProviderId;
  name: string;
  available: boolean;
  status: AiProviderStatus;
  unavailableReason?: string;
  outputModes: AiRunOutputMode[];
  defaultModelId?: string;
}

const ALL_OUTPUT_MODES: readonly AiRunOutputMode[] = ["plain", "structured", "screener"];

const PROVIDER_DEFINITIONS: readonly AiProviderDefinition[] = [
  {
    id: "browser-builtin",
    name: "Browser (on-device)",
    outputModes: ["plain", "screener"],
    preferredModelIds: ["gemini-nano"],
    fastModelIds: ["gemini-nano"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    outputModes: ["plain"],
    preferredModelIds: ["llama3.2", "qwen2.5", "phi3"],
    fastModelIds: ["qwen2.5", "phi3", "llama3.2"],
  },
  {
    id: "anthropic",
    name: "Claude",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["claude-opus-4-8", "claude-sonnet-5"],
    fastModelIds: ["claude-haiku-4-5", "claude-sonnet-4-6"],
  },
  {
    id: "openai-codex",
    name: "OpenAI (ChatGPT)",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["gpt-5.6-sol", "gpt-5.6-terra"],
    fastModelIds: ["gpt-5.4-mini", "gpt-5.6-luna"],
  },
  {
    id: "openai",
    name: "OpenAI API",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.4"],
    fastModelIds: ["gpt-4o-mini", "gpt-5.4-mini", "gpt-5.4-nano"],
  },
  {
    id: "google",
    name: "Google Gemini",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["gemini-3.6-flash", "gemini-3.5-flash"],
    fastModelIds: ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite"],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["gpt-5.6-sol", "claude-sonnet-5", "gpt-5.4"],
    fastModelIds: ["claude-haiku-4.5", "gpt-5.4-mini", "gpt-5.4-nano"],
  },
  {
    id: "xai",
    name: "xAI / Grok",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["grok-4.6", "grok-4.3"],
    fastModelIds: ["grok-4.3"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: [
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.6-sol",
      "google/gemini-3.6-flash",
    ],
    fastModelIds: [
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash-lite",
      "openai/gpt-4o-mini",
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["deepseek-v4-pro", "deepseek-v4-flash"],
    fastModelIds: ["deepseek-v4-flash"],
  },
  {
    id: "groq",
    name: "Groq",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"],
    fastModelIds: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["gpt-oss-120b", "gemma-4-31b"],
    fastModelIds: ["gemma-4-31b", "gpt-oss-120b"],
  },
  {
    id: "mistral",
    name: "Mistral",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["mistral-large-2512", "mistral-large-latest"],
    fastModelIds: ["ministral-8b-latest", "ministral-3b-latest"],
  },
  {
    id: "together",
    name: "Together AI",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["Qwen/Qwen3.7-Max", "moonshotai/Kimi-K3"],
    fastModelIds: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-7B-Instruct-Turbo"],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: [
      "accounts/fireworks/models/deepseek-v4-pro",
      "accounts/fireworks/models/kimi-k2p7-code",
    ],
    fastModelIds: [
      "accounts/fireworks/models/gpt-oss-20b",
      "accounts/fireworks/models/qwen3p7-plus",
    ],
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["anthropic.claude-opus-4-8", "anthropic.claude-sonnet-5"],
    fastModelIds: ["amazon.nova-lite-v1:0", "amazon.nova-micro-v1:0"],
  },
  {
    id: "google-vertex",
    name: "Vertex AI (Gemini)",
    outputModes: ALL_OUTPUT_MODES,
    preferredModelIds: ["gemini-3.6-flash", "gemini-3.5-flash"],
    fastModelIds: ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite"],
  },
];

let detectedProviders: AiProvider[] | null = null;

export function isAiProviderId(providerId: string): providerId is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export function migrateLegacyAiProviderId(providerId: string): string {
  return LEGACY_AI_PROVIDER_ID_ALIASES[
    providerId as keyof typeof LEGACY_AI_PROVIDER_ID_ALIASES
  ] ?? providerId;
}

export function getAiProviderDefinition(
  providerId: string | null | undefined,
): AiProviderDefinition | null {
  if (!providerId) return null;
  const canonicalId = migrateLegacyAiProviderId(providerId);
  return PROVIDER_DEFINITIONS.find((provider) => provider.id === canonicalId) ?? null;
}

export function getAiProviderDefinitions(): AiProviderDefinition[] {
  return PROVIDER_DEFINITIONS.map((definition) => ({
    ...definition,
    outputModes: [...definition.outputModes],
    preferredModelIds: [...definition.preferredModelIds],
    fastModelIds: [...definition.fastModelIds],
  }));
}

function disconnectedProvider(definition: AiProviderDefinition): AiProvider {
  return {
    id: definition.id,
    name: definition.name,
    available: false,
    status: "not_authenticated",
    unavailableReason: `${definition.name} is not connected.`,
    outputModes: [...definition.outputModes],
    defaultModelId: definition.preferredModelIds[0],
  };
}

export function aiProviderFromRuntime(provider: AiRuntimeProvider): AiProvider {
  return {
    id: provider.providerId,
    name: provider.label,
    available: provider.status === "ready",
    status: provider.status,
    ...(provider.unavailableReason ? { unavailableReason: provider.unavailableReason } : {}),
    outputModes: [...provider.outputModes],
    ...(provider.defaultModelId ? { defaultModelId: provider.defaultModelId } : {}),
  };
}

/**
 * Compatibility accessor for pane code while it moves to the reactive runtime
 * catalog. It contains only Pi providers and never performs CLI discovery.
 */
export function detectProviders(): AiProvider[] {
  // An empty array is truthy, so treating it as a successful catalog would
  // freeze every surface on "No AI provider is available" after a failed
  // hosted capability.invoke. Empty means "not yet detected".
  if (detectedProviders != null && detectedProviders.length > 0) return detectedProviders;
  // Chrome's Prompt API only exists in the hosted web client. Listing the
  // on-device provider anywhere else offers a "sign in" action for a model
  // that cannot be signed into and is not present on the platform.
  detectedProviders = PROVIDER_DEFINITIONS
    .filter((definition) => definition.id !== "browser-builtin" || isHostedWebClient())
    .map(disconnectedProvider);
  return detectedProviders;
}

export function getAiProvider(
  providerId: string | null | undefined,
  providers: readonly AiProvider[] = detectProviders(),
): AiProvider | null {
  if (!providerId) return null;
  const canonicalId = migrateLegacyAiProviderId(providerId);
  return providers.find((provider) => provider.id === canonicalId) ?? null;
}

export function resolveDefaultAiProviderId(
  providers: readonly AiProvider[] = detectProviders(),
): AiProviderId {
  if (isHostedWebClient()) {
    const browser = providers.find((provider) => provider.id === "browser-builtin");
    // Prefer Chrome on hosted even before availability settles so we do not
    // persist a cloud provider as the default. "ready" includes downloadable.
    // Never select a dead browser provider when Chrome reports it unavailable.
    if (browser && browser.status !== "check_failed") return browser.id;
  }
  return providers.find((provider) => provider.status === "ready")?.id
    ?? providers[0]?.id
    ?? "anthropic";
}

export function getAiProviderUnavailableReason(provider: AiProvider): string {
  return provider.unavailableReason ?? `${provider.name} is not connected.`;
}

export function getAiProviderUnavailableLabel(provider: AiProvider): string {
  return provider.status === "check_failed" ? "unavailable" : "sign in";
}

export function setDetectedProviders(providers: AiProvider[] | null): void {
  if (!providers || providers.length === 0) {
    detectedProviders = null;
    return;
  }
  detectedProviders = providers.map((provider) => ({
    ...provider,
    outputModes: [...provider.outputModes],
  }));
}

export { isHostedWebClient } from "../../../shared/hosted-api";
