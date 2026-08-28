import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type Context,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { spawn } from "child_process";
import { mkdirSync } from "fs";
import {
  FACTORY_AUTH_PATH,
  FACTORY_WORKDIR,
  LOCAL_DROID_PATH,
  resolveDroidBinary,
} from "./detect";
import {
  estimateTokens,
  formatTracedError,
  previewText,
  writeAiRunPromptFile,
  writeAiRunTrace,
} from "../run-trace";

export const FACTORY_PROVIDER_ID = "factory";
export const FACTORY_PROVIDER_NAME = "Factory";
export { isFactoryCliAvailable, resolveDroidBinary, FACTORY_WORKDIR } from "./detect";

export const FACTORY_AGENT_SYSTEM_PROMPT = [
  "You are the AI agent inside Gloomberb. Layouts, panes, datasets, commands, and plugin files are your computer.",
  "Driving the live app and creating plugins are the same job. Open, place, and configure panes the same way you write a plugin that registers them.",
  "The user prompt already lists the live desk. Do not ask them to attach panes or tickers.",
  "To change the live app, reply with one remote-control JSON object. Prefer call or batch.",
  "Do not reply with get, schema, or help. Those dumps are not the user-facing answer.",
  "Examples:",
  "{\"type\":\"call\",\"operation\":\"pane.show\",\"input\":{\"paneId\":\"sec\"}}",
  "{\"type\":\"call\",\"operation\":\"pane.createFromTemplate\",\"input\":{\"templateId\":\"sec-pane\"}}",
  "Chart: {\"type\":\"call\",\"operation\":\"pane.createFromTemplate\",\"input\":{\"templateId\":\"chart-composer-pane\",\"options\":{\"arg\":\"POLY:fed-cut-september, FRED:FEDFUNDS\"}}}",
  "pane.show chart-composer is empty. Seed series with chart-composer-pane options.arg. Comma-separated SYMBOL:field, FRED:seriesId, POLY:marketId, KALSHI:ticker.",
  "A themed layout is a named desk with related panes already tiled. Never layout.new with only a name when the user asked to create a working layout. Pick 4-6 panes that belong together. Tile them via layout.new panes[]. Do not get, schema, or help first.",
  "Politics: {\"type\":\"call\",\"operation\":\"layout.new\",\"input\":{\"name\":\"Democrats\",\"panes\":[\"polls\",\"congress-trades\",\"adjacent-indices\",\"prediction-markets\",\"news-firehose\"]}}",
  "Markets: {\"type\":\"call\",\"operation\":\"layout.new\",\"input\":{\"name\":\"Trading\",\"panes\":[\"portfolio-list\",\"ticker-research\",\"market-movers\",\"fear-greed\",\"sectors\"]}}",
  "Macro: {\"type\":\"call\",\"operation\":\"layout.new\",\"input\":{\"name\":\"Macro\",\"panes\":[\"econ-calendar\",\"yield-curve\",\"world-indices\",\"treasury-auctions\",\"federal-register\",\"news-firehose\"]}}",
  "News: {\"type\":\"call\",\"operation\":\"layout.new\",\"input\":{\"name\":\"Newsroom\",\"panes\":[\"news-firehose\",\"news-top-pane\",\"substack-pane\",\"macro-tv-pane\",\"twitter-feed-pane\"]}}",
  "Known pane and template ids by theme: politics — polls, congress-trades, adjacent-indices, prediction-markets, news-firehose, twitter-feed-pane. markets — portfolio-list, ticker-research, market-movers, fear-greed, sectors, volatility, short-interest, market-halts, earnings-calendar, insider. macro — econ-calendar, yield-curve, world-indices, treasury-auctions, federal-register, credit-conditions, fear-greed, cds, fx-matrix, futures. news — news-firehose, news-top-pane, news-breaking-pane, news-feed-pane, substack-pane, macro-tv-pane, twitter-feed-pane. research — sec, ticker-news, earnings-calendar, ipo-calendar, analyst-research, owid, chart-composer, tradingview. For a theme not listed here, read app://pane-templates once to discover the right ids, then layout.new with panes[].",
  "layout.new creates and switches to the named desk. Do not use layout.open in the create example. Pass activate false only if they asked to keep the current desk.",
  "Batch uses requests (plural). Never emit {\"type\":\"batch\"} without that array. The live desk is already in context.",
  "Never use capability.invoke.",
  "When writing plugins, the working directory is ~/.gloomberb/plugins/. Stay there.",
  "A plugin default-exports a GloomPlugin with setup(ctx).",
  "Register panes with a command-bar shortcut and a description.",
  "Data tables need sortable headers. Long lists need search. Network panes register a Connection and support refresh.",
  "Write files, then they can be reloaded. Do not scan the Gloomberb application repo.",
  "If the task is only conversation, reply with prose. If the task is an app change, reply with JSON only.",
].join(" ");

const FACTORY_BASE_URL = "https://app.factory.ai";
const MAX_FACTORY_PROMPT_CHARS = 120_000;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { ...ZERO_COST, total: 0 },
};

function factoryModel(
  id: string,
  name: string,
  input: ("text" | "image")[] = ["text", "image"],
): Model<"pi-messages"> {
  return {
    id,
    name,
    api: "pi-messages",
    provider: FACTORY_PROVIDER_ID,
    baseUrl: FACTORY_BASE_URL,
    reasoning: true,
    input,
    cost: ZERO_COST,
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

const FACTORY_MODELS: readonly Model<"pi-messages">[] = [
  factoryModel("claude-sonnet-5", "Claude Sonnet 5"),
  factoryModel("claude-opus-5", "Claude Opus 5"),
  factoryModel("claude-opus-5-fast", "Claude Opus 5 Fast"),
  factoryModel("gpt-5.6-terra", "GPT-5.6 Terra"),
  factoryModel("gpt-5.6-luna", "GPT-5.6 Luna"),
  factoryModel("gemini-3.7-flash", "Gemini 3.7 Flash"),
  factoryModel("grok-4.6", "Grok 4.6"),
  factoryModel("deepseek-v4-pro", "DeepSeek V4 Pro", ["text"]),
  factoryModel("kimi-k3", "Kimi K3", ["text"]),
  factoryModel("glm-5.2", "GLM-5.2", ["text"]),
];

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: { type?: string; text?: string }) => block.type === "text")
    .map((block: { text?: string }) => block.text ?? "")
    .join("\n");
}

export function extractPrompt(context: Context): string {
  const system = context.systemPrompt?.trim() ?? "";
  const turns: string[] = [];
  for (const message of context.messages) {
    const text = messageText(message.content).trim();
    if (!text) continue;
    turns.push(message.role === "assistant" ? `Assistant: ${text}` : text);
  }
  const joined = [system, ...turns].filter(Boolean).join("\n\n");
  if (joined.length <= MAX_FACTORY_PROMPT_CHARS) return joined;

  const budget = Math.max(0, MAX_FACTORY_PROMPT_CHARS - system.length - 32);
  let used = 0;
  const kept: string[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (used + turn.length + 2 > budget && kept.length > 0) break;
    kept.unshift(turn);
    used += turn.length + 2;
  }
  return [system, "...[earlier conversation truncated]...", ...kept].filter(Boolean).join("\n\n");
}

export function buildDroidExecArgs(modelId: string, promptFile: string, cwd: string): string[] {
  return [
    "exec",
    "--output-format", "json",
    "--auto", "low",
    "--disable-builtin-skills",
    "--cwd", cwd,
    "-m", modelId,
    "-f", promptFile,
  ];
}

export function parseDroidExecOutput(stdout: string, stderr: string): string {
  const raw = stdout.trim();
  if (!raw) {
    throw new Error(stderr.trim() || "droid exec returned no output.");
  }
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      subtype?: string;
      is_error?: boolean;
      result?: unknown;
    };
    const result = typeof parsed.result === "string" ? parsed.result : raw;
    if (parsed.type === "result" && parsed.is_error) {
      throw new Error(result || "droid exec returned an error.");
    }
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) return raw;
    throw error;
  }
}

function buildAssistantMessage(
  model: Model<"pi-messages">,
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: model.api,
    provider: FACTORY_PROVIDER_ID,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    timestamp: Date.now(),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function runDroidExec(model: Model<"pi-messages">, prompt: string, signal?: AbortSignal): Promise<string> {
  mkdirSync(FACTORY_WORKDIR, { recursive: true });
  const runId = `factory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const promptFile = writeAiRunPromptFile(runId, prompt);
  const args = buildDroidExecArgs(model.id, promptFile, FACTORY_WORKDIR);
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(resolveDroidBinary(), args, {
      cwd: FACTORY_WORKDIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const writeTrace = (error?: string, exitCode?: number | null) => {
      try {
        return writeAiRunTrace({
          id: runId,
          timestamp: started,
          providerId: FACTORY_PROVIDER_ID,
          modelId: model.id,
          cwd: FACTORY_WORKDIR,
          command: [resolveDroidBinary(), ...args],
          promptChars: prompt.length,
          estimatedTokens: estimateTokens(prompt),
          promptPreview: previewText(prompt),
          stdoutPreview: stdout ? previewText(stdout) : undefined,
          stderr: stderr.trim() || undefined,
          exitCode,
          durationMs: Date.now() - started,
          error,
          files: { prompt: promptFile },
        });
      } catch {
        return promptFile;
      }
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      writeTrace("aborted", null);
      finish(() => reject(Object.assign(new Error("droid exec aborted."), { name: "AbortError" })));
    };

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      const tracePath = writeTrace(err.message, null);
      finish(() => reject(formatTracedError(new Error(`Failed to spawn droid: ${err.message}`), tracePath)));
    });
    child.on("close", (code) => {
      finish(() => {
        if (signal?.aborted) {
          writeTrace("aborted", code);
          reject(Object.assign(new Error("droid exec aborted."), { name: "AbortError" }));
          return;
        }
        if (code !== 0) {
          const failure = new Error(`droid exec exited ${code}: ${stderr.trim() || stdout.trim()}`);
          reject(formatTracedError(failure, writeTrace(failure.message, code)));
          return;
        }
        try {
          const result = parseDroidExecOutput(stdout, stderr);
          writeTrace(undefined, code);
          resolve(result);
        } catch (error) {
          reject(formatTracedError(error, writeTrace(error instanceof Error ? error.message : String(error), code)));
        }
      });
    });

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function streamFactory(
  model: Model<"pi-messages">,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const stream = createAssistantMessageEventStream();
  const signal = options?.signal;

  void (async () => {
    try {
      const prompt = extractPrompt(context);
      if (!prompt) {
        const errorMsg = buildAssistantMessage(model, "", "error", "No prompt provided.");
        stream.push({ type: "error", reason: "error", error: errorMsg });
        stream.end(errorMsg);
        return;
      }

      const partial = buildAssistantMessage(model, "");
      stream.push({ type: "start", partial });

      const result = await runDroidExec(model, prompt, signal);
      const finalMessage = buildAssistantMessage(model, result, "stop");
      stream.push({ type: "text_start", contentIndex: 0, partial: finalMessage });
      stream.push({ type: "text_delta", contentIndex: 0, delta: result, partial: finalMessage });
      stream.push({ type: "text_end", contentIndex: 0, content: result, partial: finalMessage });
      stream.push({ type: "done", reason: "stop", message: finalMessage });
      stream.end(finalMessage);
    } catch (err) {
      const aborted = signal?.aborted || (err instanceof Error && err.name === "AbortError");
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorMsg = buildAssistantMessage(
        model,
        "",
        aborted ? "aborted" : "error",
        errorMessage,
      );
      stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: errorMsg });
      stream.end(errorMsg);
    }
  })();

  return stream;
}

export function createFactoryProvider(): Provider<"pi-messages"> {
  return createProvider({
    id: FACTORY_PROVIDER_ID,
    name: FACTORY_PROVIDER_NAME,
    baseUrl: FACTORY_BASE_URL,
    auth: {
      apiKey: {
        name: "Factory Droid",
        async check({ ctx }) {
          if (await ctx.fileExists(LOCAL_DROID_PATH) || await ctx.fileExists(FACTORY_AUTH_PATH)) {
            return { type: "api_key", source: "droid CLI" };
          }
          return undefined;
        },
        async resolve({ ctx }) {
          if (await ctx.fileExists(LOCAL_DROID_PATH) || await ctx.fileExists(FACTORY_AUTH_PATH)) {
            return { auth: {}, source: "droid CLI" };
          }
          return undefined;
        },
      },
    },
    models: FACTORY_MODELS,
    api: {
      stream: streamFactory,
      streamSimple: streamFactory,
    },
  });
}
