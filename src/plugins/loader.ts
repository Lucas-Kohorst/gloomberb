import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import type { GloomPlugin } from "../types/plugin";
import { debugLog } from "../utils/debug-log";

const loaderLog = debugLog.createLogger("plugin-loader");

// The hosted web bundle imports this module (the plugin market pane calls
// getPluginsDir behind a native-runtime guard), and `process` does not exist
// there. Resolving the directory on first use instead of at module scope keeps
// importing this file side-effect free in the browser.
let pluginsDir: string | null = null;

export interface LoadedExternalPlugin {
  plugin: GloomPlugin;
  path: string;
  error?: string;
}

export function getPluginsDir(): string {
  pluginsDir ??= join(process.env.HOME || homedir(), ".gloomberb", "plugins");
  return pluginsDir;
}

export async function loadExternalPlugins(): Promise<LoadedExternalPlugin[]> {
  const rootDir = getPluginsDir();
  if (!existsSync(rootDir)) return [];

  const results: LoadedExternalPlugin[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(rootDir, entry.name);

    // Look for entry file
    let entryFile: string | null = null;

    // Check package.json first
    const pkgPath = join(pluginDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await Bun.file(pkgPath).text());
        if (pkg.main) entryFile = join(pluginDir, pkg.main);
      } catch { /* ignore malformed package.json */ }
    }

    // Fall back to index files
    if (!entryFile) {
      for (const candidate of ["index.ts", "index.tsx", "index.js"]) {
        const p = join(pluginDir, candidate);
        if (existsSync(p)) { entryFile = p; break; }
      }
    }

    if (!entryFile) continue;

    try {
      const mod = await import(entryFile);
      const plugin: GloomPlugin = mod.default ?? mod.plugin;
      if (plugin && plugin.id && plugin.name) {
        loaderLog.info(`Loaded external plugin: ${plugin.id} v${plugin.version ?? "0.0.0"}`);
        results.push({ plugin, path: pluginDir });
      }
    } catch (err) {
      loaderLog.error(`Failed to load plugin from ${pluginDir}: ${err}`);
      results.push({
        plugin: { id: entry.name, name: entry.name, version: "0.0.0" } as GloomPlugin,
        path: pluginDir,
        error: String(err),
      });
    }
  }

  return results;
}
