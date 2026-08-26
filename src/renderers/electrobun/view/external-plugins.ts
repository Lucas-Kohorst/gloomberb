import type { GloomPlugin } from "../../../types/plugin";
import type { LoadedExternalPlugin } from "../../../plugins/loader";
import { getSharedRegistry } from "../../../plugins/registry";
import { isHostedWebClient } from "../../../shared/hosted-api";
import type { DesktopExternalPluginBundle } from "../shared/protocol";
import { debugLog } from "../../../utils/debug-log";

const log = debugLog.createLogger("desktop-external-plugins");
let loadedExternalIds = new Set<string>();

async function instantiatePluginJs(js: string): Promise<GloomPlugin> {
  const blob = new Blob([js], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ url) as { default?: GloomPlugin; plugin?: GloomPlugin };
    const plugin = mod.default ?? mod.plugin;
    if (!plugin?.id || !plugin.name) {
      throw new Error("Plugin module is missing a default GloomPlugin export.");
    }
    return plugin;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function instantiateExternalPluginBundles(
  bundles: DesktopExternalPluginBundle[] | undefined,
): Promise<LoadedExternalPlugin[]> {
  if (!bundles || bundles.length === 0) return [];
  const loaded: LoadedExternalPlugin[] = [];
  for (const bundle of bundles) {
    if (bundle.error || !bundle.js) {
      loaded.push({
        plugin: { id: bundle.dirName, name: bundle.dirName, version: "0.0.0" },
        path: bundle.entryFile,
        entryFile: bundle.entryFile,
        error: bundle.error ?? "Plugin compile produced no JavaScript.",
      });
      continue;
    }
    try {
      const plugin = await instantiatePluginJs(bundle.js);
      loaded.push({
        plugin,
        path: bundle.entryFile,
        entryFile: bundle.entryFile,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Failed to instantiate external plugin", { dirName: bundle.dirName, error: message });
      loaded.push({
        plugin: { id: bundle.dirName, name: bundle.dirName, version: "0.0.0" },
        path: bundle.entryFile,
        entryFile: bundle.entryFile,
        error: message,
      });
    }
  }
  return loaded;
}

export function rememberLoadedExternalPluginIds(ids: Iterable<string>): void {
  loadedExternalIds = new Set(ids);
}

export async function applyExternalPluginBundles(
  bundles: DesktopExternalPluginBundle[],
): Promise<void> {
  const registry = getSharedRegistry();
  if (!registry) return;
  const loaded = await instantiateExternalPluginBundles(bundles);
  const nextIds = new Set(loaded.filter((entry) => !entry.error).map((entry) => entry.plugin.id));
  const addedIds = [...nextIds].filter((pluginId) => !loadedExternalIds.has(pluginId));
  for (const pluginId of loadedExternalIds) {
    if (nextIds.has(pluginId)) continue;
    try {
      registry.unregister(pluginId);
    } catch {
      // Ignore dispose failures for a plugin that was removed from disk.
    }
  }
  for (const entry of loaded) {
    if (entry.error) continue;
    if (registry.allPlugins.has(entry.plugin.id)) {
      try {
        registry.unregister(entry.plugin.id);
      } catch {
        // Keep going so a failed dispose does not block the new module.
      }
    }
    await registry.registerExternalPlugin(entry.plugin, entry.entryFile ?? entry.path);
  }
  loadedExternalIds = nextIds;
  for (const pluginId of addedIds) registry.openPrimaryPluginPane(pluginId);
}

export function shouldLoadDesktopExternalPlugins(): boolean {
  return !isHostedWebClient();
}
