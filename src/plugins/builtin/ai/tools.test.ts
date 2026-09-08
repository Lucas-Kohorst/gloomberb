import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from "fs";
import { mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseToolCalls, createPluginTools, executeToolCall, getToolDefinitions } from "./tools";
import { setPluginsDirForTests } from "../../loader";
import { PluginRegistry } from "../../registry";
import { AppPersistence } from "../../../data/app-persistence";
import { TickerRepository } from "../../../data/ticker-repository";
import { createDefaultConfig } from "../../../types/config";
import type { DataProvider } from "../../../types/data-provider";

const dataProvider: DataProvider = {
  id: "test-provider",
  name: "Test Provider",
  getTickerFinancials: async () => ({ annualStatements: [], quarterlyStatements: [], priceHistory: [] }),
  getQuote: async (symbol) => ({
    symbol,
    price: 1,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
  }),
  getExchangeRate: async () => 1,
  search: async () => [],
  getArticleSummary: async () => null,
  getPriceHistory: async () => [],
};

function createRegistry(dataDir: string): PluginRegistry {
  const persistence = new AppPersistence(":memory:");
  const registry = new PluginRegistry(dataProvider, new TickerRepository(persistence.tickers), persistence);
  registry.getConfigFn = () => createDefaultConfig(dataDir);
  return registry;
}

describe("parseToolCalls", () => {
  test("parses fenced json blocks with tool field", () => {
    const response = 'Here is a tool call:\n```json\n{"tool": "write_file", "args": {"path": "test.ts", "content": "hello"}}\n```\nDone.';
    const calls = parseToolCalls(response);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("write_file");
    expect(calls[0].args.path).toBe("test.ts");
    expect(calls[0].args.content).toBe("hello");
  });

  test("parses multiple fenced json blocks", () => {
    const response = '```json\n{"tool": "list_plugins", "args": {}}\n```\nThen:\n```json\n{"tool": "reload_plugin", "args": {"pluginId": "my-plugin"}}\n```';
    const calls = parseToolCalls(response);
    expect(calls).toHaveLength(2);
    expect(calls[0].tool).toBe("list_plugins");
    expect(calls[1].tool).toBe("reload_plugin");
  });

  test("returns empty for responses without tool calls", () => {
    expect(parseToolCalls("Just a normal response")).toHaveLength(0);
    expect(parseToolCalls("```json\n{\"foo\": \"bar\"}\n```")).toHaveLength(0);
  });

  test("ignores malformed json in fences", () => {
    const response = '```json\nnot valid json\n```';
    expect(parseToolCalls(response)).toHaveLength(0);
  });
});

describe("createPluginTools", () => {
  test("returns all expected tools", () => {
    const tools = createPluginTools(undefined);
    const names = tools.map((t) => t.name);
    expect(names).toContain("write_file");
    expect(names).toContain("read_file");
    expect(names).toContain("list_plugins");
    expect(names).toContain("reload_plugin");
    expect(names).toContain("fork_plugin");
    expect(names).toContain("validate_plugin");
  });

  test("getToolDefinitions strips execute functions", () => {
    const tools = createPluginTools(undefined);
    const defs = getToolDefinitions(tools);
    for (const def of defs) {
      expect(def).not.toHaveProperty("execute");
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });
});

describe("tool execution", () => {
  let tempDir: string;

  test("write_file writes content under plugins dir", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gloomberb-tools-test"));
    const pluginsDir = join(tempDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });

    // Override GLOOMBERB_DATA_DIR so getPluginsDir uses our temp dir.
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = tempDir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      const result = await executeToolCall(tools, { tool: "write_file", args: { path: "my-plugin/index.ts", content: "export default { id: 'test' }" } });
      expect(result.success).toBe(true);
      expect(existsSync(join(pluginsDir, "my-plugin", "index.ts"))).toBe(true);
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("list_plugins returns registered plugins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-tools-test"));
    try {
      const registry = createRegistry(dir);
      await registry.register({ id: "test-plugin", name: "Test Plugin", version: "1.0.0" });
      const tools = createPluginTools(registry);
      const result = await executeToolCall(tools, { tool: "list_plugins", args: {} });
      expect(result.success).toBe(true);
      expect(result.output).toContain("test-plugin");
      expect(result.output).toContain("Test Plugin");
      registry.destroy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects write_file escapes and never creates files outside the plugins root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-traversal-test"));
    const pluginsDir = join(dir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      const result = await executeToolCall(tools, {
        tool: "write_file",
        args: { path: "../outside.txt", content: "pwn" },
      });
      expect(result.success).toBe(false);
      expect(result.output).toContain("within the plugins directory");
      expect(existsSync(join(dir, "outside.txt"))).toBe(false);
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("write_file exits via a sibling-prefix check, not a string prefix check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-prefix-test"));
    const pluginsDir = join(dir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      // ../plugins-backup only shares a string prefix with the plugins root;
      // it must still be rejected as outside the boundary.
      const result = await executeToolCall(tools, {
        tool: "write_file",
        args: { path: "../plugins-backup/entry.ts", content: "export default 1" },
      });
      expect(result.success).toBe(false);
      expect(result.output).toContain("within the plugins directory");
      expect(existsSync(join(dir, "plugins-backup"))).toBe(false);
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("write_file does not follow a symlinked directory out of the plugins root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-symlink-test"));
    const pluginsDir = join(dir, "plugins");
    const outsideDir = join(dir, "outside");
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, join(pluginsDir, "linked"));
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      const result = await executeToolCall(tools, {
        tool: "write_file",
        args: { path: "linked/pwn.ts", content: "export default 1" },
      });
      expect(result.success).toBe(false);
      expect(existsSync(join(outsideDir, "pwn.ts"))).toBe(false);
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("read_file rejects absolute traversal and the raw-prefix sibling bypass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-read-test"));
    const pluginsDir = join(dir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      const appRoot = process.cwd();
      const traversal = join(appRoot, "..", "etc", "passwd");
      const result = await executeToolCall(tools, {
        tool: "read_file",
        args: { path: traversal },
      });
      expect(result.success).toBe(false);
      expect(result.output).toContain("within the plugins directory or the app source directory");

      // A sibling whose name shares the appRoot prefix must also be rejected.
      const siblingPrefixed = `${appRoot}-secrets/db.env`;
      const siblingResult = await executeToolCall(tools, {
        tool: "read_file",
        args: { path: siblingPrefixed },
      });
      expect(siblingResult.success).toBe(false);
      expect(siblingResult.output).toContain("within the plugins directory or the app source directory");
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fork_plugin rejects traversal in the source and destination ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-fork-test"));
    const pluginsDir = join(dir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      const badSource = await executeToolCall(tools, {
        tool: "fork_plugin",
        args: { sourcePluginId: "../../..", newId: "backup" },
      });
      expect(badSource.success).toBe(false);
      expect(badSource.output).toContain("Invalid source plugin id");

      const badTarget = await executeToolCall(tools, {
        tool: "fork_plugin",
        args: { sourcePluginId: "ai", newId: "../escape" },
      });
      expect(badTarget.success).toBe(false);
      expect(badTarget.output).toContain("within the plugins directory");
      expect(existsSync(join(dir, "escape"))).toBe(false);
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validate_plugin rejects absolute paths outside the plugins root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-validate-test"));
    const pluginsDir = join(dir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const outsideFile = join(dir, "payload.ts");
    writeFileSync(outsideFile, "export default {}");
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const tools = createPluginTools(undefined);
      const result = await executeToolCall(tools, {
        tool: "validate_plugin",
        args: { path: outsideFile },
      });
      expect(result.success).toBe(false);
      expect(result.output).toContain("within the plugins directory");
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reload_plugin rejects path-shaped plugin ids before touching the registry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gloomberb-reload-test"));
    const pluginsDir = join(dir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const origDataDir = process.env.GLOOMBERB_DATA_DIR;
    process.env.GLOOMBERB_DATA_DIR = dir;
    setPluginsDirForTests(null);
    try {
      const registry = createRegistry(dir);
      const tools = createPluginTools(registry);
      const result = await executeToolCall(tools, {
        tool: "reload_plugin",
        args: { pluginId: "../../tmp/gloomberb-rat" },
      });
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid plugin id");
      registry.destroy();
    } finally {
      process.env.GLOOMBERB_DATA_DIR = origDataDir;
      setPluginsDirForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("executeToolCall returns failure for unknown tool", async () => {
    const tools = createPluginTools(undefined);
    const result = await executeToolCall(tools, { tool: "nonexistent", args: {} });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });
});
