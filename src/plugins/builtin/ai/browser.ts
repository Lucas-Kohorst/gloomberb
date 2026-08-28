import type {
  AiConversationMessage,
  AiRunController,
  AiRunHost,
  AiRunOutputMode,
  AiRuntimeCatalog,
  AiRuntimeProvider,
} from "./runner";
import type { AiProviderStatus } from "./providers";
import type { PaneSettingsDef } from "../../../types/plugin";
import { isHostedWebClient } from "./providers";
import { withDeadline } from "../../../utils/async-deadline";
import { getInProcessRemoteHandle } from "../../../remote/in-process-handle";
import type { AiAgentHistoryMessage } from "./agent-history";
import { applyRemoteControlText, parseRemoteControlRequest } from "./remote-request";

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

const BROWSER_AI_SESSION_OPTIONS = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

interface LanguageModelApi {
  availability(options?: typeof BROWSER_AI_SESSION_OPTIONS): Promise<BrowserAiAvailability>;
  create(options?: typeof BROWSER_AI_SESSION_OPTIONS): Promise<LanguageModelSession>;
}

function languageModel(): LanguageModelApi | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  // Chrome exposes LanguageModel as a constructor function, not a plain object.
  if (candidate == null || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return null;
  }
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
      reason: "On-device AI needs desktop Chrome with Prompt API. This browser or window does not expose it — add a key below, or open the hosted terminal in Chrome.",
    };
  }
  try {
    const availability = await withDeadline(
      api.availability(BROWSER_AI_SESSION_OPTIONS),
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
      reason: "This machine does not meet Chrome's on-device model requirements (disk, GPU, or RAM).",
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
  await api.create(BROWSER_AI_SESSION_OPTIONS);
  return getBrowserAiState();
}

const STRUCTURED_NANO_INSTRUCTIONS = [
  "You are the AI agent inside Gloomberb. Layouts, panes, datasets, and commands are your computer.",
  "Reply with JSON only. Either a remote-control request or {\"message\":\"your answer\"}.",
  "Valid request types: help, schema, get, call, patch, batch.",
  "Read app://snapshot, app://pane-types, app://pane-templates, app://commands, or app://connections before guessing ids.",
  "Examples:",
  "{\"type\":\"get\",\"resource\":\"app://pane-types\"}",
  "{\"type\":\"call\",\"operation\":\"pane.show\",\"input\":{\"paneId\":\"sec\"}}",
  "{\"type\":\"call\",\"operation\":\"pane.createFromTemplate\",\"input\":{\"templateId\":\"sec-filings\"}}",
  "{\"type\":\"call\",\"operation\":\"pane.createFromTemplate\",\"input\":{\"templateId\":\"chart-composer-pane\",\"options\":{\"arg\":\"POLY:fed-cut-september, FRED:FEDFUNDS\"}}}",
  "pane.show chart-composer is empty. Seed series with chart-composer-pane options.arg.",
  "{\"type\":\"call\",\"operation\":\"layout.new\",\"input\":{\"name\":\"Democrats\"}}",
  "Never use capability.invoke.",
].join(" ");

export const parseBrowserRemoteControlRequest = parseRemoteControlRequest;

async function collectPromptOutput(
  session: LanguageModelSession,
  prompt: string,
  signal: AbortSignal,
  onChunk?: (output: string) => void,
): Promise<string> {
  if (session.promptStreaming) {
    let output = "";
    for await (const chunk of session.promptStreaming(prompt, { signal })) {
      const delta = chunk.startsWith(output) ? chunk.slice(output.length) : chunk;
      output += delta;
      onChunk?.(delta);
    }
    return output;
  }
  const output = await session.prompt(prompt, { signal });
  onChunk?.(output);
  return output;
}

async function runHostedStructuredRequest(
  raw: string,
  onAgentMessages?: (messages: AiAgentHistoryMessage[]) => void,
): Promise<string | null> {
  const handle = getInProcessRemoteHandle();
  try {
    const result = await applyRemoteControlText(
      raw,
      async (request) => {
        if (!handle) return { ok: false, error: { code: "remote_unavailable", message: "Live app remote handle is not mounted." } };
        return handle(request);
      },
      onAgentMessages,
    );
    return result.applied ? result.output : null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function createBrowserAiRunController(options: {
  prompt: string;
  messages?: AiConversationMessage[];
  onChunk?: (output: string) => void;
  onAgentMessages?: (messages: AiAgentHistoryMessage[]) => void;
  outputMode?: AiRunOutputMode;
}): AiRunController {
  const abort = new AbortController();
  const done = (async () => {
    const api = languageModel();
    if (!api) throw new Error("Chrome's built-in on-device model is unavailable.");
    const state = await getBrowserAiState();
    if (state.availability !== "available") throw new Error(state.reason);
    const session = await api.create(BROWSER_AI_SESSION_OPTIONS);
    try {
      const conversation = [...(options.messages ?? []), { role: "user", content: options.prompt }]
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n");
      const prompt = options.outputMode === "structured"
        ? `${STRUCTURED_NANO_INSTRUCTIONS}\n\n${conversation}`
        : conversation;
      const output = await collectPromptOutput(session, prompt, abort.signal, options.onChunk);
      if (options.outputMode !== "structured") return output;
      try {
        const remoteOutput = await runHostedStructuredRequest(output, options.onAgentMessages);
        return remoteOutput ?? output;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
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
  outputModes: ["plain", "structured", "screener"],
  defaultModelId: "gemini-nano",
};

export function buildBrowserAiRuntimeCatalog(state: BrowserAiState): AiRuntimeCatalog {
  const status = browserAiProviderStatus(state);
  return {
    providers: [{
      ...browserAiRuntimeProvider,
      status: status.status,
      ...(status.unavailableReason ? { unavailableReason: status.unavailableReason } : {}),
    }],
    accounts: [{
      providerId: "browser-builtin",
      providerLabel: "Browser (on-device)",
      connectionState: status.available ? "connected" : "not_connected",
      connectionLabel: state.reason,
      authMethods: [],
      canLogin: false,
      canDisconnect: false,
    }],
    models: [{
      id: "gemini-nano",
      providerId: "browser-builtin",
      label: "Gemini Nano",
      available: status.available,
    }],
  };
}

const HOSTED_PROVIDER_UNAVAILABLE = "is not available in the hosted client.";

/** Host adapter used by the hosted web renderer; the native Pi host remains untouched. */
export function createBrowserAiRunHost(
  catalog?: AiRuntimeCatalog,
): AiRunHost {
  return {
    async getCatalog() {
      return catalog ?? buildBrowserAiRuntimeCatalog(await refreshBrowserAiState());
    },
    async checkStatus(providerId) {
      if (providerId !== "browser-builtin") {
        return {
          available: false,
          authenticated: false,
          message: `${providerId} ${HOSTED_PROVIDER_UNAVAILABLE}`,
        };
      }
      const state = await refreshBrowserAiState();
      const status = browserAiProviderStatus(state);
      return {
        available: status.available,
        authenticated: status.available,
        message: status.available ? null : (status.unavailableReason ?? state.reason),
      };
    },
    run({ providerId, prompt, messages, onChunk, onAgentMessages, outputMode }) {
      if (providerId !== "browser-builtin") {
        return {
          done: Promise.reject(new Error(`${providerId} ${HOSTED_PROVIDER_UNAVAILABLE}`)),
          cancel: () => {},
        };
      }
      return createBrowserAiRunController({
        prompt,
        messages,
        onChunk,
        onAgentMessages,
        outputMode,
      });
    },
  };
}
