import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync, watch, type FSWatcher } from "fs";
import { homedir } from "os";
import type { GloomPlugin, PluginTarget } from "../types/plugin";
import { debugLog } from "../utils/debug-log";
import { linkHostPackages } from "./host-link";

const loaderLog = debugLog.createLogger("plugin-loader");

// The hosted web bundle imports this module (the plugin market pane calls
// getPluginsDir behind a native-runtime guard), and `process` does not exist
// there. Resolving the directory on first use instead of at module scope keeps
// importing this file side-effect free in the browser.
let pluginsDir: string | null = null;

export interface LoadedExternalPlugin {
  plugin: GloomPlugin;
  path: string;
  entryFile?: string;
  error?: string;
  /** Set when the plugin loaded but does not support the running renderer. */
  unsupportedTarget?: PluginTarget;
}

export function getPluginsDir(): string {
  // GLOOMBERB_DATA_DIR has to cover external plugins too, or an "isolated"
  // session still loads whatever the developer has installed under $HOME and a
  // locally installed plugin can collide with a built-in module id.
  pluginsDir ??= process.env.GLOOMBERB_DATA_DIR
    ? join(process.env.GLOOMBERB_DATA_DIR, "plugins")
    : join(process.env.HOME || homedir(), ".gloomberb", "plugins");
  return pluginsDir;
}

/**
 * Resolve the entry file for a plugin directory. Checks package.json `main`
 * first, then falls back to index.ts / index.tsx / index.js. Returns null if
 * no entry file is found.
 */
export function resolvePluginEntryFile(pluginDir: string): string | null {
  // Check package.json first
  const pkgPath = join(pluginDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.main) {
        const candidate = join(pluginDir, pkg.main);
        if (existsSync(candidate)) return candidate;
      }
    } catch { /* ignore malformed package.json */ }
  }

  // Fall back to index files
  for (const candidate of ["index.ts", "index.tsx", "index.js"]) {
    const p = join(pluginDir, candidate);
    if (existsSync(p)) return p;
  }

  return null;
}

export function setPluginsDirForTests(dir: string | null): void {
  pluginsDir = dir;
}

export interface ExternalPluginEntry {
  dirName: string;
  pluginDir: string;
  entryFile: string;
}

export async function listExternalPluginEntries(
  rootDir = getPluginsDir(),
): Promise<ExternalPluginEntry[]> {
  if (!existsSync(rootDir)) return [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  const plugins: ExternalPluginEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(rootDir, entry.name);
    const entryFile = resolvePluginEntryFile(pluginDir);
    if (entryFile) plugins.push({ dirName: entry.name, pluginDir, entryFile });
  }
  return plugins;
}

/** Resolves a plugin directory's entry file the way `bun install` would. */
export async function resolvePluginEntry(pluginDir: string): Promise<string | null> {
  const pkgPath = join(pluginDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      if (pkg.main) {
        const main = join(pluginDir, pkg.main);
        if (existsSync(main)) return main;
      }
    } catch {
      // Malformed package.json falls through to the index candidates.
    }
  }
  for (const candidate of ["index.ts", "index.tsx", "index.js"]) {
    const path = join(pluginDir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

export function pluginSupportsTarget(plugin: GloomPlugin, target: PluginTarget): boolean {
  // No declaration means "everywhere"; the registry fills this in for listed plugins.
  return !plugin.targets || plugin.targets.length === 0 || plugin.targets.includes(target);
}

export async function loadExternalPlugins(target: PluginTarget = "cli"): Promise<LoadedExternalPlugin[]> {
  const rootDir = getPluginsDir();
  if (!existsSync(rootDir)) return [];

  const results: LoadedExternalPlugin[] = [];
  const entries = await listExternalPluginEntries(rootDir);

  for (const entry of entries) {
    const pluginDir = entry.pluginDir;
    const entryFile = entry.entryFile;

    // Repairs `gloomberb`/`react` links for plugins copied in by hand or left
    // behind by a `bun install` that pruned them.
    linkHostPackages(pluginDir);

    try {
      const mod = await import(entryFile);
      const plugin: GloomPlugin = mod.default ?? mod.plugin;
      if (plugin && plugin.id && plugin.name) {
        if (!pluginSupportsTarget(plugin, target)) {
          loaderLog.info(`Skipped ${plugin.id}: does not support "${target}"`);
          results.push({ plugin, path: pluginDir, unsupportedTarget: target });
          continue;
        }
        loaderLog.info(`Loaded external plugin: ${plugin.id} v${plugin.version ?? "0.0.0"}`);
        results.push({ plugin, path: pluginDir, entryFile });
      }
    } catch (err) {
      loaderLog.error(`Failed to load plugin from ${pluginDir}: ${err}`);
      results.push({
        plugin: { id: entry.dirName, name: entry.dirName, version: "0.0.0" } as GloomPlugin,
        path: pluginDir,
        error: String(err),
      });
    }
  }

  return results;
}

/**
 * Watch the external plugins directory for changes. On any file change event
 * (after a debounce), the callback is invoked. Only active on native runtimes
 * (Bun). Returns a dispose function that stops the watcher.
 */
export function watchPluginsDir(
  callback: () => void,
  debounceMs = 800,
): () => void {
  if (typeof Bun === "undefined") return () => {};

  const rootDir = getPluginsDir();
  if (!existsSync(rootDir)) return () => {};

  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const debouncedCallback = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!disposed) callback();
    }, debounceMs);
  };

  try {
    watcher = watch(rootDir, { recursive: true }, () => {
      debouncedCallback();
    });
  } catch {
    // recursive watch may not be supported on all platforms; fall back to non-recursive
    try {
      watcher = watch(rootDir, () => {
        debouncedCallback();
      });
    } catch {
      loaderLog.error("Failed to watch plugins directory");
      return () => {};
    }
  }

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
