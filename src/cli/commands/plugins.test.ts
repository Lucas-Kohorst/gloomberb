import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scaffoldPlugin,
  toDisplayName,
  toVariableName,
} from "./plugins";
import { buildScaffold, SCAFFOLD_TEMPLATES } from "../scaffold/templates";
import { setPluginsDirForTests } from "../../plugins/loader";

describe("toDisplayName", () => {
  test("converts hyphenated name to title case", () => {
    expect(toDisplayName("my-cool-plugin")).toBe("My Cool Plugin");
  });

  test("handles single word", () => {
    expect(toDisplayName("portfolio")).toBe("Portfolio");
  });

  test("handles already-camelcased segments", () => {
    expect(toDisplayName("rss-feed")).toBe("Rss Feed");
  });
});

describe("toVariableName", () => {
  test("converts hyphenated name to camelCase", () => {
    expect(toVariableName("my-cool-plugin")).toBe("myCoolPlugin");
  });

  test("handles single word", () => {
    expect(toVariableName("portfolio")).toBe("portfolio");
  });
});

describe("buildScaffold", () => {
  test("pane-only generates a valid GloomPlugin skeleton", () => {
    const output = buildScaffold("my-plugin", "pane-only");
    const indexFile = output.files.find((f) => f.filename === "index.ts")!;
    expect(indexFile.content).toContain('id: "my-plugin"');
    expect(indexFile.content).toContain('name: "My Plugin"');
    expect(indexFile.content).toContain('version: "0.1.0"');
    expect(indexFile.content).toContain("toggleable: true");
    expect(indexFile.content).toContain("setup(ctx)");
    expect(indexFile.content).toContain("export default myPlugin");
    expect(indexFile.content).toContain('import type { GloomPlugin } from "gloomberb/types/plugin"');
  });

  test("chart-source generates createChartSource and client.ts", () => {
    const output = buildScaffold("my-source", "chart-source");
    const indexFile = output.files.find((f) => f.filename === "index.ts")!;
    const clientFile = output.files.find((f) => f.filename === "client.ts")!;
    expect(indexFile.content).toContain("createChartSource");
    expect(indexFile.content).toContain("resolveMySourceSeries");
    expect(clientFile.content).toContain("resolveMySourceSeries");
    expect(clientFile.content).toContain("withConnectionRequest");
  });

  test("document-source generates createDocumentSource and client.ts", () => {
    const output = buildScaffold("my-docs", "document-source");
    const indexFile = output.files.find((f) => f.filename === "index.ts")!;
    const clientFile = output.files.find((f) => f.filename === "client.ts")!;
    expect(indexFile.content).toContain("createDocumentSource");
    expect(clientFile.content).toContain("withConnectionRequest");
  });

  test("data-pane generates headless model and client.ts", () => {
    const output = buildScaffold("my-data", "data-pane");
    const indexFile = output.files.find((f) => f.filename === "index.ts")!;
    const clientFile = output.files.find((f) => f.filename === "client.ts")!;
    expect(indexFile.content).toContain("HeadlessPaneDefinition");
    expect(indexFile.content).toContain("createConnection");
    expect(clientFile.content).toContain("withConnectionRequest");
  });

  test("research-tab generates createResearchTab", () => {
    const output = buildScaffold("my-tab", "research-tab");
    const indexFile = output.files.find((f) => f.filename === "index.ts")!;
    expect(indexFile.content).toContain("createResearchTab");
    expect(indexFile.content).toContain("TickerResearchTabProps");
  });

  test("command-only generates registerCommand", () => {
    const output = buildScaffold("my-cmd", "command-only");
    const indexFile = output.files.find((f) => f.filename === "index.ts")!;
    expect(indexFile.content).toContain("registerCommand");
    expect(indexFile.content).toContain("registerAgentPromptFragment");
  });

  test("all templates generate package.json", () => {
    for (const template of SCAFFOLD_TEMPLATES) {
      const output = buildScaffold("test-plugin", template);
      const pkgFile = output.files.find((f) => f.filename === "package.json")!;
      const pkg = JSON.parse(pkgFile.content);
      expect(pkg.name).toBe("test-plugin");
      expect(pkg.version).toBe("0.1.0");
      expect(pkg.main).toBe("index.ts");
    }
  });
});

describe("scaffoldPlugin", () => {
  function makeTempPluginsDir(): string {
    const dir = join(tmpdir(), `gloomberb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  test("creates index.ts and package.json in the plugins directory", () => {
    const tempDir = makeTempPluginsDir();
    setPluginsDirForTests(tempDir);
    try {
      scaffoldPlugin("test-plugin");
      const pluginDir = join(tempDir, "test-plugin");
      expect(existsSync(pluginDir)).toBe(true);
      expect(existsSync(join(pluginDir, "index.ts"))).toBe(true);
      expect(existsSync(join(pluginDir, "package.json"))).toBe(true);

      const indexContent = readFileSync(join(pluginDir, "index.ts"), "utf-8");
      expect(indexContent).toContain('id: "test-plugin"');
      expect(indexContent).toContain('name: "Test Plugin"');
      expect(indexContent).toContain("registerAgentPromptFragment");
      expect(indexContent).toContain("test-plugin-pane");
      expect(indexContent).toContain("description:");

      const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf-8"));
      expect(pkg.name).toBe("test-plugin");
      expect(pkg.version).toBe("0.1.0");
    } finally {
      setPluginsDirForTests(null);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("chart-source template creates client.ts", () => {
    const tempDir = makeTempPluginsDir();
    setPluginsDirForTests(tempDir);
    try {
      scaffoldPlugin("chart-test", "chart-source");
      const pluginDir = join(tempDir, "chart-test");
      expect(existsSync(join(pluginDir, "client.ts"))).toBe(true);
      const indexContent = readFileSync(join(pluginDir, "index.ts"), "utf-8");
      expect(indexContent).toContain("createChartSource");
    } finally {
      setPluginsDirForTests(null);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects invalid plugin names", () => {
    const tempDir = makeTempPluginsDir();
    setPluginsDirForTests(tempDir);
    try {
      expect(() => scaffoldPlugin("../escape")).toThrow();
      expect(() => scaffoldPlugin("has space")).toThrow();
    } finally {
      setPluginsDirForTests(null);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails when plugin already exists", () => {
    const tempDir = makeTempPluginsDir();
    setPluginsDirForTests(tempDir);
    try {
      scaffoldPlugin("dup-plugin");
      expect(() => scaffoldPlugin("dup-plugin")).toThrow();
    } finally {
      setPluginsDirForTests(null);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
