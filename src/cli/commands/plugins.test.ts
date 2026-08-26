import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildPluginIndexContent,
  buildPluginPackageJson,
  scaffoldPlugin,
  toDisplayName,
  toVariableName,
} from "./plugins";
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

describe("buildPluginIndexContent", () => {
  test("generates a valid GloomPlugin skeleton", () => {
    const content = buildPluginIndexContent("my-plugin");
    expect(content).toContain('id: "my-plugin"');
    expect(content).toContain('name: "My Plugin"');
    expect(content).toContain('version: "0.1.0"');
    expect(content).toContain("toggleable: true");
    expect(content).toContain("setup(ctx)");
    expect(content).toContain("export default myPlugin");
    expect(content).toContain('import type { GloomPlugin } from "gloomberb/types/plugin"');
  });

  test("uses camelCase variable name", () => {
    const content = buildPluginIndexContent("market-data");
    expect(content).toContain("export const marketData: GloomPlugin");
    expect(content).toContain("export default marketData");
  });
});

describe("buildPluginPackageJson", () => {
  test("generates valid package.json with name and version", () => {
    const json = JSON.parse(buildPluginPackageJson("my-plugin"));
    expect(json.name).toBe("my-plugin");
    expect(json.version).toBe("0.1.0");
    expect(json.main).toBe("index.ts");
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

      const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf-8"));
      expect(pkg.name).toBe("test-plugin");
      expect(pkg.version).toBe("0.1.0");
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
