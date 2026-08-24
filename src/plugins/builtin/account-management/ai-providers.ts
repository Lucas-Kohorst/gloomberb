import type { AppConfig } from "../../../types/config";
import type { AiProvider, AiProviderId } from "../ai/providers";
import {
  AI_PROVIDER_IDS,
  getAiProviderDefinition,
  isHostedWebClient,
} from "../ai/providers";
import type { AiRuntimeAccount, AiRuntimeCatalog } from "../ai/runner";
import type { BrowserAiState } from "../ai/browser";
import { getByokKnownService } from "../byok/services";
import {
  readByokKeysFromConfig,
} from "../byok/store";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokApiKeyEntry } from "../byok/types";

/**
 * BYOK service ids that correspond to AI providers. Keys added for these
 * services are surfaced in the ACM inventory and never duplicated into a
 * second store.
 */
export const AI_BYOK_SERVICE_IDS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "openrouter",
  "github-copilot",
  "openai-codex",
] as const;

export type AiByokServiceId = (typeof AI_BYOK_SERVICE_IDS)[number];

/** Default Ollama endpoint. The user can override it via a BYOK entry. */
export const OLLAMA_DEFAULT_URL = "http://localhost:11434";
export const OLLAMA_BYOK_SERVICE_ID = "ollama";

/**
 * Terminal status for a provider in the ACM inventory. Every provider must
 * reach one of these — never "checking" — so the user always knows what is
 * usable and what to fix.
 */
export type AiInventoryStatus =
  | "available"
  | "needs-key"
  | "unavailable"
  | "error"
  | "checking";

export interface AiProviderInventoryRow {
  id: AiProviderId;
  name: string;
  /** Terminal status that drives the row's color and fix action. */
  status: AiInventoryStatus;
  /** Human-readable detail for the status (shown in the row, not the title). */
  detail: string;
  /** True when this provider is the currently configured default. */
  isActive: boolean;
  /** True for Chrome built-in AI, listed first and labelled as preferred. */
  preferred: boolean;
  /** True when the provider accepts a BYOK API key. */
  hasKey: boolean;
  /** True when the provider is OAuth-capable (Pi-managed). */
  canOAuth: boolean;
  /** True when the provider is a local endpoint (Ollama / Chrome on-device). */
  isLocal: boolean;
  /** BYOK service id for key management, or null when no key applies. */
  byokServiceId: string | null;
}

export interface AiInventorySnapshot {
  rows: AiProviderInventoryRow[];
  activeProviderId: AiProviderId | null;
}

export interface ResolveAiInventoryOptions {
  catalog: AiRuntimeCatalog;
  browserAiState: BrowserAiState | null;
  ollamaState: OllamaAvailability | null;
  byokKeys: ByokApiKeyEntry[];
  activeProviderId: string | null;
}

export type OllamaAvailability = "available" | "unavailable" | "checking";

export interface OllamaCheckResult {
  availability: OllamaAvailability;
  models: string[];
}

const OLLAMA_CHECK_TIMEOUT_MS = 3_000;

/**
 * Checks whether a local Ollama server is running by hitting its `/api/tags`
 * endpoint. Bounded by a timeout so it never hangs on "checking".
 */
export async function checkOllamaAvailability(
  endpoint: string = OLLAMA_DEFAULT_URL,
): Promise<OllamaCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/tags`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { availability: "unavailable", models: [] };
    }
    const data = await response.json() as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((model) => model.name ?? "").filter(Boolean);
    return { availability: "available", models };
  } catch {
    return { availability: "unavailable", models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves the Ollama endpoint URL from BYOK keys or falls back to the default. */
export function resolveOllamaEndpoint(byokKeys: ByokApiKeyEntry[]): string {
  const entry = byokKeys.find((key) => key.serviceId === OLLAMA_BYOK_SERVICE_ID);
  return entry?.apiUrl?.trim() || OLLAMA_DEFAULT_URL;
}

function hasByokKey(byokKeys: ByokApiKeyEntry[], serviceId: string): boolean {
  return byokKeys.some((key) => key.serviceId === serviceId && Boolean(key.apiKey.trim()));
}

function piProviderStatus(
  account: AiRuntimeAccount | undefined,
  hasKey: boolean,
  canOAuth: boolean,
): { status: AiInventoryStatus; detail: string } {
  if (account?.connectionState === "connected") {
    return { status: "available", detail: account.connectionLabel || "Connected." };
  }
  if (account?.connectionState === "error") {
    return { status: "error", detail: account.connectionLabel || "Connection error." };
  }
  if (hasKey) {
    return { status: "available", detail: "API key configured." };
  }
  if (canOAuth) {
    return { status: "needs-key", detail: "Sign in or add an API key to use this provider." };
  }
  return { status: "needs-key", detail: "Add an API key to use this provider." };
}

function browserProviderStatus(
  state: BrowserAiState | null,
): { status: AiInventoryStatus; detail: string } {
  if (!state || !isHostedWebClient()) {
    return {
      status: "unavailable",
      detail: "Chrome's built-in on-device AI requires desktop Chrome in the hosted web client.",
    };
  }
  if (state.availability === "available") {
    return { status: "available", detail: "On-device model is ready." };
  }
  if (state.availability === "downloadable") {
    return { status: "needs-key", detail: "Download the on-device model to enable this provider." };
  }
  if (state.availability === "downloading") {
    return { status: "checking", detail: "Chrome is downloading the on-device model." };
  }
  return {
    status: "unavailable",
    detail: state.reason || "Chrome's on-device model is not available on this device.",
  };
}

function ollamaProviderStatus(
  state: OllamaAvailability | null,
  endpoint: string,
): { status: AiInventoryStatus; detail: string } {
  if (state === "available") {
    return { status: "available", detail: `Running at ${endpoint}.` };
  }
  if (state === "checking") {
    return { status: "checking", detail: `Checking ${endpoint}…` };
  }
  return {
    status: "unavailable",
    detail: `Not reachable at ${endpoint}. Start Ollama with: ollama serve`,
  };
}

/**
 * Builds the unified AI provider inventory for the ACM. Every provider reaches
 * a terminal status (available / needs-key / unavailable / error) so the user
 * always knows which provider is active and what to fix.
 */
export function resolveAiInventory(options: ResolveAiInventoryOptions): AiInventorySnapshot {
  const { catalog, browserAiState, ollamaState, byokKeys, activeProviderId } = options;
  const rows: AiProviderInventoryRow[] = [];

  for (const providerId of AI_PROVIDER_IDS) {
    const definition = getAiProviderDefinition(providerId);
    if (!definition) continue;

    const isActive = providerId === activeProviderId;
    const account = catalog.accounts.find((candidate) => candidate.providerId === providerId);

    if (providerId === "browser-builtin") {
      const { status, detail } = browserProviderStatus(browserAiState);
      rows.push({
        id: providerId,
        name: definition.name,
        status,
        detail,
        isActive,
        preferred: true,
        hasKey: false,
        canOAuth: false,
        isLocal: true,
        byokServiceId: null,
      });
      continue;
    }

    if (providerId === "ollama") {
      const endpoint = resolveOllamaEndpoint(byokKeys);
      const { status, detail } = ollamaProviderStatus(ollamaState, endpoint);
      rows.push({
        id: providerId,
        name: definition.name,
        status,
        detail,
        isActive,
        preferred: false,
        hasKey: false,
        canOAuth: false,
        isLocal: true,
        byokServiceId: OLLAMA_BYOK_SERVICE_ID,
      });
      continue;
    }

    const byokServiceId = AI_BYOK_SERVICE_IDS.includes(providerId as AiByokServiceId)
      ? providerId
      : null;
    const hasKey = byokServiceId ? hasByokKey(byokKeys, byokServiceId) : false;
    const canOAuth = account?.authMethods.some((method) => method.type === "oauth" && method.canLogin) ?? false;
    const { status, detail } = piProviderStatus(account, hasKey, canOAuth);

    rows.push({
      id: providerId,
      name: definition.name,
      status,
      detail,
      isActive,
      preferred: false,
      hasKey,
      canOAuth,
      isLocal: false,
      byokServiceId,
    });
  }

  return {
    rows,
    activeProviderId: (activeProviderId as AiProviderId) ?? null,
  };
}

/** Reads BYOK key entries from an AppConfig, for components without a plugin context. */
export function readAiByokKeys(config: AppConfig): ByokApiKeyEntry[] {
  return readByokKeysFromConfig(config);
}

/** Returns the config path where BYOK keys are stored, for useAppSelector. */
export function byokKeysConfigSelector(state: { config: AppConfig }): ByokApiKeyEntry[] {
  const stored = state.config.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY] as
    | { keys?: ByokApiKeyEntry[] }
    | undefined;
  if (!stored?.keys || !Array.isArray(stored.keys)) return [];
  return stored.keys;
}

/** Human-readable label for a provider's terminal status. */
export function aiInventoryStatusLabel(status: AiInventoryStatus): string {
  switch (status) {
    case "available": return "Available";
    case "needs-key": return "Needs key";
    case "unavailable": return "Unavailable";
    case "error": return "Error";
    case "checking": return "Checking";
  }
}

/** Color token for a provider's terminal status. */
export function aiInventoryStatusColor(status: AiInventoryStatus): string {
  switch (status) {
    case "available": return "positive";
    case "needs-key": return "warn";
    case "unavailable": return "muted";
    case "error": return "negative";
    case "checking": return "muted";
  }
}

/**
 * The fix action a user should take for a provider that is not available.
 * Returns null when the provider is already available.
 */
export function aiInventoryFixAction(row: AiProviderInventoryRow): {
  label: string;
  kind: "add-key" | "start-ollama" | "download-model" | "sign-in" | "none";
} | null {
  if (row.status === "available") return null;
  if (row.id === "browser-builtin") {
    if (row.status === "needs-key") return { label: "Download model", kind: "download-model" };
    return { label: "Unsupported browser", kind: "none" };
  }
  if (row.id === "ollama") {
    return { label: "Start Ollama", kind: "start-ollama" };
  }
  if (row.canOAuth && !row.hasKey) {
    return { label: "Sign in or add key", kind: "sign-in" };
  }
  if (row.byokServiceId) {
    return { label: "Add key", kind: "add-key" };
  }
  return { label: "Sign in", kind: "sign-in" };
}

/**
 * Determines whether a provider can be selected as the active provider.
 * Available providers and providers with a configured key are selectable.
 */
export function canSelectAiProvider(row: AiProviderInventoryRow): boolean {
  if (row.id === "browser-builtin") {
    return row.status === "available" || row.status === "needs-key";
  }
  return row.status === "available" || row.hasKey;
}

const AI_PROVIDER_API_URLS: Readonly<Record<string, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  google: "https://generativelanguage.googleapis.com",
  xai: "https://api.x.ai",
  openrouter: "https://openrouter.ai/api",
  "github-copilot": "https://api.githubcopilot.com",
  "openai-codex": "https://api.openai.com",
};

/**
 * Maps an AI provider id to a BYOK known-service definition for registration
 * during plugin setup. Returns null for providers without a BYOK service.
 */
export function aiProviderByokService(
  providerId: AiProviderId,
): { id: string; name: string; apiUrl?: string; authType: "bearer" | "none"; description: string } | null {
  if (providerId === "ollama") {
    return {
      id: OLLAMA_BYOK_SERVICE_ID,
      name: "Ollama (local)",
      apiUrl: OLLAMA_DEFAULT_URL,
      authType: "none",
      description: "Local Ollama LLM server. No API key required; configure the endpoint URL if not default.",
    };
  }
  if (providerId === "browser-builtin") return null;
  const existing = getByokKnownService(providerId);
  if (existing) {
    return { ...existing, authType: existing.authType === "none" ? "none" : "bearer" };
  }
  if (AI_BYOK_SERVICE_IDS.includes(providerId as AiByokServiceId)) {
    const definition = getAiProviderDefinition(providerId);
    return {
      id: providerId,
      name: definition?.name ?? providerId,
      apiUrl: AI_PROVIDER_API_URLS[providerId],
      authType: "bearer",
      description: `${definition?.name ?? providerId} API key for AI features.`,
    };
  }
  return null;
}
