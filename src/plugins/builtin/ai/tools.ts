import { basename, dirname, join, resolve, sep } from "path";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "fs";
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

/**
 * True when `candidate` (already a resolved absolute path) equals `root` or
 * sits strictly inside it. The boundary is a path separator, so a sibling
 * directory that merely shares the root's name prefix does not pass.
 */
function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/**
 * Canonicalize `target`, resolving symlinks in its deepest existing ancestor.
 * This is the containment check to use when the final component may not exist
 * yet (e.g. a file that is about to be written) but a symlink could still
 * redirect the resolved directory chain outside the intended root. Falls back
 * to the normalized lexical path when nothing under `target` exists.
 */
function canonicalPath(target: string): string {
  let current = resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...suffix);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(target);
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `candidate` under `root` and verify it stays inside `root` after
 * both normalization (`..` segments, sibling-prefix collisions) and symlink
 * resolution. Returns the normalized absolute path when contained, otherwise
 * null. Every AI file tool that touches the filesystem funnels through this.
 */
function resolveWithinRoot(root: string, candidate: string): string | null {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  if (!isWithinRoot(resolvedRoot, resolvedCandidate)) return null;
  if (!isWithinRoot(canonicalPath(resolvedRoot), canonicalPath(resolvedCandidate))) return null;
  return resolvedCandidate;
}

/**
 * A plugin id is a directory name inside the plugins root. Reject path-shaped
 * values so reload_plugin can never resolve (and import) outside that tree.
 */
function isSafePluginId(pluginId: string): boolean {
  if (pluginId.length === 0 || pluginId.length > 128) return false;
  if (pluginId.startsWith(".")) return false;
  if (pluginId.includes("/") || pluginId.includes("\\")) return false;
  return true;
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

        const pluginsRoot = getPluginsDir();
        // Canonical containment: normalization rejects `..`/sibling-prefix
        // escapes and the real-path check rejects symlink escapes before any
        // file is created or overwritten (see resolveWithinRoot).
        const fullPath = resolveWithinRoot(pluginsRoot, join(pluginsRoot, relPath));
        if (!fullPath) {
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

        const pluginsRoot = getPluginsDir();
        const appRoot = process.cwd();
        // Canonical containment on a resolved, symlink-checked path. The raw
        // prefix form allowed /<appRoot>/../ traversal and sibling directories
        // sharing the root's name; resolveWithinRoot rejects both.
        const fullPath = relPath.startsWith("/")
          ? resolveWithinRoot(appRoot, relPath)
          : resolveWithinRoot(pluginsRoot, join(pluginsRoot, relPath));
        if (!fullPath) {
          return { success: false, output: "Path must stay within the plugins directory or the app source directory" };
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
        if (!isSafePluginId(pluginId)) {
          return { success: false, output: `Invalid plugin id: ${pluginId}` };
        }
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
        const builtinPluginsRoot = join(appRoot, "src", "plugins", "builtin");
        const sourceDir = resolveWithinRoot(builtinPluginsRoot, join(builtinPluginsRoot, sourcePluginId));
        if (!sourceDir) {
          return { success: false, output: `Invalid source plugin id: ${sourcePluginId}` };
        }
        if (!existsSync(sourceDir)) {
          return { success: false, output: `Built-in plugin source not found: ${sourcePluginId}` };
        }

        const pluginsRoot = getPluginsDir();
        const targetDir = resolveWithinRoot(pluginsRoot, join(pluginsRoot, newId));
        if (!targetDir) {
          return { success: false, output: `Target must stay within the plugins directory: ${newId}` };
        }
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

        const pluginsRoot = getPluginsDir();
        let entryFile: string | null = null;

        if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js")) {
          // Absolute or relative, the entry file must resolve inside the
          // plugins root: validate_plugin imports its target, so containment
          // here is a code-execution boundary, not just a read boundary.
          const resolved = path.startsWith("/")
            ? resolveWithinRoot(pluginsRoot, path)
            : resolveWithinRoot(pluginsRoot, join(pluginsRoot, path));
          if (!resolved) {
            return { success: false, output: "Path must stay within the plugins directory" };
          }
          entryFile = resolved;
        } else {
          // Treat as directory name.
          const pluginDir = resolveWithinRoot(pluginsRoot, join(pluginsRoot, path));
          if (!pluginDir) {
            return { success: false, output: "Path must stay within the plugins directory" };
          }
          entryFile = resolvePluginEntryFile(pluginDir);
          if (entryFile && !resolveWithinRoot(pluginsRoot, entryFile)) {
            return { success: false, output: "Plugin entry file must stay within the plugins directory" };
          }
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
