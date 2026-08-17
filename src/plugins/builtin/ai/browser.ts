import type {
  AiConversationMessage,
  AiRunController,
  AiRunHost,
  AiRuntimeCatalog,
  AiRuntimeProvider,
} from "./runner";
import type { AiProviderStatus } from "./providers";
import type { PaneSettingsDef } from "../../../types/plugin";
import { isHostedWebClient } from "./providers";
import { withDeadline } from "../../../utils/async-deadline";

const BROWSER_AI_CHECK_TIMEOUT_MS = 5_000;

export type BrowserAiAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export interface BrowserAiState {
  availability: BrowserAiAvailability;
  reason: string;
}

export { isHostedWebClient };

let cachedBrowserAiState: BrowserAiState = {
  availability: "unavailable",
  reason: "Checking Chrome's built-in on-device model…",
};

export function getBrowserAiStateSnapshot(): BrowserAiState {
  return cachedBrowserAiState;
}

export async function refreshBrowserAiState(): Promise<BrowserAiState> {
  cachedBrowserAiState = await getBrowserAiState();
  return cachedBrowserAiState;
}

export function buildBrowserAiSettings(): PaneSettingsDef {
  const state = cachedBrowserAiState;
  const canDownload = state.availability === "downloadable";
  return {
    title: "Browser AI",
    values: { browserAiAvailability: state.availability },
    fields: [
      {
        key: "browserAiAvailability",
        label: "Local browser model",
        description: `${state.reason} Prompts stay on this device and are not sent to a remote provider.`,
        type: "action",
        actionId: "ai:browser-model",
        actionLabel: canDownload ? "Download model" : "Refresh status",
        disabled: !canDownload,
        action: async (context) => {
          try {
            if (canDownload) await downloadBrowserAiModel();
            const next = await refreshBrowserAiState();
            context.notify({
              body: `Browser model: ${next.availability}. ${next.reason}`,
              type: next.availability === "unavailable" ? "error" : "success",
            });
          } catch (error) {
            context.notify({
              body: error instanceof Error ? error.message : "Browser model download failed.",
              type: "error",
              persistent: true,
            });
          }
        },
      },
    ],
  };
}

interface LanguageModelSession {
  prompt(prompt: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming?(
    prompt: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<string>;
  destroy?: () => void;
}

interface LanguageModelApi {
  availability(options?: { languages?: string[] }): Promise<BrowserAiAvailability>;
  create(): Promise<LanguageModelSession>;
}

function languageModel(): LanguageModelApi | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  if (!candidate || typeof candidate !== "object") return null;
  const api = candidate as Partial<LanguageModelApi>;
  return typeof api.availability === "function" && typeof api.create === "function"
    ? api as LanguageModelApi
    : null;
}

export async function getBrowserAiState(): Promise<BrowserAiState> {
  const api = languageModel();
  if (!api) {
    return {
      availability: "unavailable",
      reason: "Chrome's built-in Prompt API is not available in this browser or channel.",
    };
  }
  try {
    const availability = await withDeadline(
      api.availability({ languages: ["en"] }),
      BROWSER_AI_CHECK_TIMEOUT_MS,
      "Chrome's built-in Prompt API availability check timed out.",
    );
    if (availability === "available") {
      return { availability, reason: "The on-device model is ready." };
    }
    if (availability === "downloadable") {
      return { availability, reason: "The on-device model is ready to download." };
    }
    if (availability === "downloading") {
      return { availability, reason: "Chrome is downloading the on-device model." };
    }
    return {
      availability: "unavailable",
      reason: "This device cannot run Chrome's on-device model.",
    };
  } catch {
    return {
      availability: "unavailable",
      reason: "Chrome could not determine whether its on-device model is available.",
    };
  }
}

export function browserAiProviderStatus(state: BrowserAiState): {
  available: boolean;
  status: AiProviderStatus;
  unavailableReason?: string;
} {
  if (state.availability === "available" || state.availability === "downloadable") {
    return { available: true, status: "ready" };
  }
  return {
    available: false,
    status: "check_failed",
    unavailableReason: state.availability === "unavailable"
      ? `${state.reason} Requirements: desktop Chrome only (not mobile), about 22 GB free space, and either a GPU with over 4 GB VRAM or 16 GB RAM with at least 4 CPU cores.`
      : state.reason,
  };
}

/**
 * Starts the download only when called from a user-initiated action. Chrome
 * enforces this for the "downloadable" state.
 */
export async function downloadBrowserAiModel(): Promise<BrowserAiState> {
  const api = languageModel();
  if (!api) return getBrowserAiState();
  if (typeof navigator !== "undefined" && !navigator.userActivation?.isActive) {
    throw new Error("Start the Chrome model download from a user-initiated action.");
  }
  await api.create();
  return getBrowserAiState();
}

export function createBrowserAiRunController(options: {
  prompt: string;
  messages?: AiConversationMessage[];
  onChunk?: (output: string) => void;
}): AiRunController {
  const abort = new AbortController();
  const done = (async () => {
    const api = languageModel();
    if (!api) throw new Error("Chrome's built-in on-device model is unavailable.");
    const state = await getBrowserAiState();
    if (state.availability !== "available") throw new Error(state.reason);
    const session = await api.create();
    try {
      const prompt = [...(options.messages ?? []), { role: "user", content: options.prompt }]
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n");
      if (session.promptStreaming) {
        let output = "";
        for await (const chunk of session.promptStreaming(prompt, { signal: abort.signal })) {
          const delta = chunk.startsWith(output) ? chunk.slice(output.length) : chunk;
          output += delta;
          options.onChunk?.(delta);
        }
        return output;
      }
      const output = await session.prompt(prompt, { signal: abort.signal });
      options.onChunk?.(output);
      return output;
    } finally {
      session.destroy?.();
    }
  })();
  return { done, cancel: () => abort.abort() };
}

export const browserAiRuntimeProvider: AiRuntimeProvider = {
  providerId: "browser-builtin",
  label: "Browser (on-device)",
  status: "ready",
  outputModes: ["plain"],
  defaultModelId: "gemini-nano",
};

/** Host adapter used by the web renderer; the native Pi host remains untouched. */
export function createBrowserAiRunHost(
  catalog: AiRuntimeCatalog,
): AiRunHost {
  return {
    getCatalog: async () => catalog,
    run: ({ prompt, messages, onChunk }) => createBrowserAiRunController({
      prompt,
      messages,
      onChunk,
    }),
  };
}
