import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync } from "fs";
import { homedir } from "os";
import type { GloomPlugin } from "../../../types/plugin";
import type { PluginRegistry } from "../../registry";
import { resolvePluginEntryFile, getPluginsDir } from "../../loader";
import { debugLog } from "../../../utils/debug-log";

const toolsLog = debugLog.createLogger("ai-tools");

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (args: Record<string, unknown>) => Promise<PluginToolResult>;
}

export interface PluginToolResult {
  success: boolean;
  output: string;
  data?: unknown;
}

/**
 * Parsed tool call extracted from an AI response.
 */
export interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * @deprecated Text-parsing tool path. The agent protocol (pi-agent-core)
 * handles tool-use internally via typed AgentTool objects; do not wire this
 * back into a run path. Retained for tools.test.ts coverage only.
 *
 * Parse fenced JSON tool-call blocks from an AI text response.
 *
 * Supports both ```json fenced blocks and bare inline JSON objects containing
 * a "tool" field. Returns all parsed tool calls in order of appearance.
 */
export function parseToolCalls(response: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Match fenced ```json blocks that contain a "tool" field.
  const fencePattern = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(response)) !== null) {
    const jsonText = (match[1] ?? "").trim();
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed.tool === "string") {
        calls.push({ tool: parsed.tool, args: parsed.args ?? {} });
      }
    } catch {
      // Not valid JSON — skip.
    }
  }

  // If no fenced blocks found, try bare inline JSON objects with "tool" field.
  if (calls.length === 0) {
    const inlinePattern = /\{"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^}]*\})\}/g;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = inlinePattern.exec(response)) !== null) {
      try {
        const args = JSON.parse(inlineMatch[2] ?? "{}");
        calls.push({ tool: inlineMatch[1] ?? "", args });
      } catch {
        // skip
      }
    }
  }

  return calls;
}

function getPluginsRoot(): string {
  return process.env.HOME ? join(process.env.HOME, ".gloomberb", "plugins") : join(homedir(), ".gloomberb", "plugins");
}

/**
 * Create the set of plugin tools the AI agent can invoke.
 */
export function createPluginTools(registry: PluginRegistry | undefined): PluginTool[] {
  const tools: PluginTool[] = [
    {
      name: "write_file",
      description: "Write content to a file under ~/.gloomberb/plugins/. The path is relative to the plugins directory.",
      parameters: {
        path: { type: "string", description: "Relative path under ~/.gloomberb/plugins/", required: true },
        content: { type: "string", description: "File content to write", required: true },
      },
      async execute(args): Promise<PluginToolResult> {
        const relPath = String(args.path ?? "");
        const content = String(args.content ?? "");
        if (!relPath) return { success: false, output: "Missing required parameter: path" };
        if (!content && content !== "") return { success: false, output: "Missing required parameter: content" };

        const pluginsRoot = getPluginsRoot();
        const fullPath = join(pluginsRoot, relPath);

        // Prevent path traversal outside the plugins directory.
        if (!fullPath.startsWith(pluginsRoot)) {
          return { success: false, output: "Path must stay within the plugins directory" };
        }

        try {
          const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
          if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(fullPath, content, "utf-8");
          return { success: true, output: `Wrote ${relPath} (${content.length} bytes)` };
        } catch (err) {
          return { success: false, output: `Failed to write ${relPath}: ${err}` };
        }
      },
    },
    {
      name: "read_file",
      description: "Read a file from ~/.gloomberb/plugins/ or the app source directory.",
      parameters: {
        path: { type: "string", description: "Relative path under ~/.gloomberb/plugins/, or an absolute path under the app source directory (process.cwd())", required: true },
      },
      async execute(args): Promise<PluginToolResult> {
        const relPath = String(args.path ?? "");
        if (!relPath) return { success: false, output: "Missing required parameter: path" };

        const pluginsRoot = getPluginsRoot();
        const appRoot = process.cwd();
        let fullPath: string;
        if (relPath.startsWith("/")) {
          fullPath = relPath;
          if (!fullPath.startsWith(appRoot)) {
            return { success: false, output: "Path must stay within the plugins directory or the app source directory" };
          }
        } else {
          fullPath = join(pluginsRoot, relPath);
          if (!fullPath.startsWith(pluginsRoot)) {
            return { success: false, output: "Path must stay within the plugins directory" };
          }
        }

        if (!existsSync(fullPath)) {
          return { success: false, output: `File not found: ${relPath}` };
        }

        try {
          const content = readFileSync(fullPath, "utf-8");
          return { success: true, output: content, data: { path: relPath, size: content.length } };
        } catch (err) {
          return { success: false, output: `Failed to read ${relPath}: ${err}` };
        }
      },
    },
    {
      name: "list_plugins",
      description: "List all registered plugins (built-in and external) with their IDs, names, versions, and status.",
      parameters: {},
      async execute(): Promise<PluginToolResult> {
        if (!registry) return { success: false, output: "Plugin registry is not available" };
        const plugins = [...registry.allPlugins.values()];
        const lines = plugins.map((p) =>
          `${p.id}\t${p.name}\tv${p.version ?? "0.0.0"}\t${p.toggleable ? "toggleable" : "core"}`,
        );
        return {
          success: true,
          output: lines.join("\n"),
          data: plugins.map((p) => ({ id: p.id, name: p.name, version: p.version })),
        };
      },
    },
    {
      name: "reload_plugin",
      description: "Reload an external plugin by re-importing its entry file. Usually unnecessary: new plugins load and open on their own when files change.",
      parameters: {
        pluginId: { type: "string", description: "The plugin ID or directory name to reload", required: true },
      },
      async execute(args): Promise<PluginToolResult> {
        if (!registry) return { success: false, output: "Plugin registry is not available" };
        const pluginId = String(args.pluginId ?? "");
        if (!pluginId) return { success: false, output: "Missing required parameter: pluginId" };
        const result = await registry.reloadExternalPlugin(pluginId);
        return { success: result.success, output: result.message };
      },
    },
    {
      name: "fork_plugin",
      description: "Copy a built-in plugin's source to ~/.gloomberb/plugins/<new-id>/ as a starting point for modification.",
      parameters: {
        sourcePluginId: { type: "string", description: "The built-in plugin ID to fork", required: true },
        newId: { type: "string", description: "The new plugin directory / ID", required: true },
      },
      async execute(args): Promise<PluginToolResult> {
        const sourcePluginId = String(args.sourcePluginId ?? "");
        const newId = String(args.newId ?? "");
        if (!sourcePluginId) return { success: false, output: "Missing required parameter: sourcePluginId" };
        if (!newId) return { success: false, output: "Missing required parameter: newId" };

        // Find the built-in plugin source directory.
        // Built-in plugins live under src/plugins/builtin/<sourcePluginId>/.
        const appRoot = process.cwd();
        const sourceDir = join(appRoot, "src", "plugins", "builtin", sourcePluginId);
        if (!existsSync(sourceDir)) {
          return { success: false, output: `Built-in plugin source not found: ${sourcePluginId}` };
        }

        const pluginsRoot = getPluginsRoot();
        const targetDir = join(pluginsRoot, newId);
        if (existsSync(targetDir)) {
          return { success: false, output: `Target directory already exists: ${newId}` };
        }

        try {
          mkdirSync(targetDir, { recursive: true });
          cpSync(sourceDir, targetDir, { recursive: true });
          return {
            success: true,
            output: `Forked ${sourcePluginId} to ~/.gloomberb/plugins/${newId}/. Edit the plugin id in the forked source. It will load automatically.`,
          };
        } catch (err) {
          return { success: false, output: `Failed to fork: ${err}` };
        }
      },
    },
    {
      name: "validate_plugin",
      description: "Import a plugin entry file and check it has a valid GloomPlugin export with id and name.",
      parameters: {
        path: { type: "string", description: "Relative path under ~/.gloomberb/plugins/ or plugin directory name", required: true },
      },
      async execute(args): Promise<PluginToolResult> {
        const path = String(args.path ?? "");
        if (!path) return { success: false, output: "Missing required parameter: path" };

        const pluginsRoot = getPluginsRoot();
        let entryFile: string | null = null;

        if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js")) {
          entryFile = path.startsWith("/") ? path : join(pluginsRoot, path);
        } else {
          // Treat as directory name.
          const pluginDir = join(pluginsRoot, path);
          entryFile = resolvePluginEntryFile(pluginDir);
        }

        if (!entryFile || !existsSync(entryFile)) {
          return { success: false, output: `Entry file not found for: ${path}` };
        }

        try {
          const mod = await import(`${entryFile}?t=${Date.now()}`);
          const plugin: GloomPlugin = mod.default ?? mod.plugin;
          if (!plugin) return { success: false, output: "No default export or named 'plugin' export found" };
          if (!plugin.id) return { success: false, output: "Plugin export is missing 'id'" };
          if (!plugin.name) return { success: false, output: "Plugin export is missing 'name'" };
          return {
            success: true,
            output: `Valid plugin: id=${plugin.id}, name=${plugin.name}, version=${plugin.version ?? "0.0.0"}`,
            data: { id: plugin.id, name: plugin.name, version: plugin.version },
          };
        } catch (err) {
          return { success: false, output: `Failed to import: ${err}` };
        }
      },
    },
  ];

  return tools;
}

/**
 * Get the tool definitions (name, description, parameters) without execute
 * functions, suitable for sending to the AI model.
 */
export function getToolDefinitions(tools: PluginTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/**
 * @deprecated Text-parsing tool path. The agent protocol (pi-agent-core)
 * handles tool-use internally via typed AgentTool objects; do not wire this
 * back into a run path. Retained for tools.test.ts coverage only.
 *
 * Execute a parsed tool call against the available tools.
 */
export async function executeToolCall(
  tools: PluginTool[],
  call: ParsedToolCall,
): Promise<PluginToolResult> {
  const tool = tools.find((t) => t.name === call.tool);
  if (!tool) {
    return { success: false, output: `Unknown tool: ${call.tool}` };
  }
  try {
    return await tool.execute(call.args);
  } catch (err) {
    toolsLog.error("Tool execution failed", { tool: call.tool, error: String(err) });
    return { success: false, output: `Tool ${call.tool} failed: ${err}` };
  }
}

/**
 * @deprecated Text-parsing tool path. The agent protocol (pi-agent-core)
 * handles tool-use internally via typed AgentTool objects; do not wire this
 * back into a run path. Retained for tools.test.ts coverage only.
 *
 * Process all tool calls found in an AI response, executing each one and
 * returning a summary of results.
 */
export async function processToolCalls(
  tools: PluginTool[],
  response: string,
): Promise<{ results: { call: ParsedToolCall; result: PluginToolResult }[]; response: string }> {
  const calls = parseToolCalls(response);
  if (calls.length === 0) {
    return { results: [], response };
  }

  const results: { call: ParsedToolCall; result: PluginToolResult }[] = [];
  for (const call of calls) {
    const result = await executeToolCall(tools, call);
    results.push({ call, result });
  }

  return { results, response };
}
