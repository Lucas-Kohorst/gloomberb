import { Type, type TObject } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RemoteControlRequest } from "../../../../remote/types";
import { refuseUnsafeRemoteRequest } from "../remote-request";
import { dispatchCli } from "../../../../cli/index";
import { AiRunCancelledError } from "../runner";
import { createPluginTools, type PluginTool } from "../tools";
import { getSharedRegistry } from "../../../registry";

const AGENT_CLI_COMMANDS = new Set([
  "new",
  "plugin-new",
  "scaffold",
  "validate",
  "plugin-validate",
  "plugins",
  "plugin-search",
  "install",
  "update",
  "remove",
  "search",
  "ticker",
  "help",
  "api",
  "config",
  "layout",
  "quote",
  "history",
  "financials",
  "fundamentals",
  "filings",
  "holders",
  "insider",
  "13f",
  "analyst",
  "events",
  "earnings",
  "options",
  "movers",
  "sectors",
  "indices",
  "fx",
  "compare",
  "valuation",
  "correlation",
  "fear-greed",
  "yield-curve",
  "econ",
  "fred",
  "notes",
  "version",
  "changelog",
  "alerts",
  "rss",
  "relationship",
  "cache",
]);

const CliArgsSchema = Type.Object({
  args: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 16 }),
});

const ShowPaneSchema = Type.Object({
  paneId: Type.Optional(Type.String({ minLength: 1 })),
  templateId: Type.Optional(Type.String({ minLength: 1 })),
  arg: Type.Optional(Type.String({ minLength: 1 })),
});

export { refuseUnsafeRemoteRequest };

export function resolveAgentCliCommand(args: string[]): string {
  const command = args.find((arg) => !arg.startsWith("-"));
  if (!command) throw new Error("CLI args must include a command.");
  if (command === "launch-ui" || command === "ui") {
    throw new Error("The agent cannot launch a separate UI process. Use gloomberb_remote or gloomberb_show to change the live app.");
  }
  if (!AGENT_CLI_COMMANDS.has(command)) {
    throw new Error(`CLI command "${command}" is not allowed from the agent.`);
  }
  return command;
}

let cliCaptureMutex: Promise<void> = Promise.resolve();

async function captureDispatch(args: string[]): Promise<string> {
  const previousMutex = cliCaptureMutex;
  let releaseMutex: () => void = () => {};
  cliCaptureMutex = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  await previousMutex;

  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  const info = console.info;
  const warn = console.warn;
  const previousExit = process.exitCode;
  const write = (...values: unknown[]) => {
    lines.push(values.map((value) => typeof value === "string" ? value : String(value)).join(" "));
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  try {
    const result = await dispatchCli(["--json", ...args]);
    const output = lines.join("\n").trim();
    if (result.kind === "unhandled") {
      throw new Error(`Unknown CLI command: ${args[0]}`);
    }
    return output || JSON.stringify(result);
  } finally {
    console.log = log;
    console.info = info;
    console.warn = warn;
    console.error = err;
    process.exitCode = previousExit;
    releaseMutex();
  }
}

function pluginToolToAgentTool(tool: PluginTool): AgentTool<TObject, unknown> {
  const properties: Record<string, ReturnType<typeof Type.String>> = {};
  for (const [key, spec] of Object.entries(tool.parameters)) {
    properties[key] = Type.String({ description: spec.description });
  }
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: Type.Object(properties),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const result = await tool.execute(params as Record<string, unknown>);
      if (!result.success) throw new Error(result.output);
      return { content: [{ type: "text", text: result.output }], details: result.data };
    },
  };
}

export function createAgentPluginFileTools(): AgentTool[] {
  return createPluginTools(getSharedRegistry()).map(pluginToolToAgentTool);
}

export function createAgentCliTool(): AgentTool<typeof CliArgsSchema, unknown> {
  return {
    name: "gloomberb_cli",
    label: "Gloomberb CLI",
    description: [
      "Run a Gloomberb CLI command. It does not open desktop panes.",
      "Pass args like [\"new\",\"hello-world\"], [\"validate\",\"hello-world\"], [\"plugins\"], [\"search\",\"AAPL\"], or [\"quote\",\"AAPL\"].",
      "Allowed: new, validate, plugins, plugin-search, install, update, remove, search, ticker, help, api,",
      "config, layout, quote, history, financials, fundamentals, filings, holders, insider, 13f,",
      "analyst, events, earnings, options, movers, sectors, indices, fx, compare, valuation,",
      "correlation, fear-greed, yield-curve, econ, fred, notes, version, changelog, alerts, rss,",
      "relationship, cache.",
    ].join(" "),
    parameters: CliArgsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new AiRunCancelledError();
      resolveAgentCliCommand(params.args);
      const output = await captureDispatch(params.args);
      return { content: [{ type: "text", text: output }] };
    },
  };
}

export function buildAgentShowRequest(params: {
  paneId?: string;
  templateId?: string;
  arg?: string;
}): RemoteControlRequest {
  const paneId = params.paneId?.trim();
  const templateId = params.templateId?.trim();
  const arg = params.arg?.trim();
  if (paneId && templateId) throw new Error("Pass paneId or templateId, not both.");
  if (!paneId && !templateId) throw new Error("Pass paneId or templateId.");
  if (arg && paneId) throw new Error("Pass arg with templateId, not paneId.");
  if (paneId) return { type: "call", operation: "pane.show", input: { paneId } };
  return {
    type: "call",
    operation: "pane.createFromTemplate",
    input: arg ? { templateId, options: { arg } } : { templateId },
  };
}

export function createAgentShowTool(sendRequest: (
  request: RemoteControlRequest,
  options: { dataDir: string; appKind?: "tui" | "desktop" },
) => Promise<unknown>, options: { appKind: "tui" | "desktop"; dataDir: string }): AgentTool<typeof ShowPaneSchema, unknown> {
  return {
    name: "gloomberb_show",
    label: "Show pane",
    description: [
      "Open a pane when you already know the paneId or templateId.",
      "Pass paneId for a registered pane type, or templateId to create from a template.",
      "Pass arg with templateId to seed the template, such as chart-composer-pane series expressions.",
      "For ticker pin, tab switch, layout edits, or command-bar search, use gloomberb_remote instead.",
    ].join(" "),
    parameters: ShowPaneSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new AiRunCancelledError();
      const request = buildAgentShowRequest(params);
      const response = await sendRequest(request, {
        dataDir: options.dataDir,
        appKind: options.appKind,
      });
      return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
    },
  };
}
