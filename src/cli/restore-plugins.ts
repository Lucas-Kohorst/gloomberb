import { existsSync } from "fs";
import { join } from "path";
import { saveConfig } from "../data/config/store";
import { loadCliConfigIfAvailable } from "./context";
import { EXTRACTED_PLUGINS } from "../plugins/seed";
import { getPluginsDir } from "../plugins/loader";
import { debugLog } from "../utils/debug-log";

const log = debugLog.createLogger("plugin-seed");

/**
 * Reconciles the seeded-plugin bookkeeping for plugins that moved out of this
 * repository into their own repositories.
 *
 * Startup never installs those plugins: cloning a repository, installing its
 * dependencies, and importing (executing) its entry file is a code-execution
 * trust grant that requires an explicit user action — `gloomberb install
 * <owner/repo>`, which asks for confirmation before running anything. This
 * function only records plugins that already exist on disk (or that the user
 * deliberately disabled) as seeded so a launch stops re-checking them, and it
 * logs a hint when an extracted plugin is still missing.
 */
export async function restoreExtractedPlugins(): Promise<void> {
  try {
    const config = await loadCliConfigIfAvailable();
    // No data directory yet means a first run: there is nothing to restore.
    if (!config) return;

    const pluginsDir = getPluginsDir();
    const alreadySeeded = new Set(config.seededPlugins ?? []);
    const seeded = new Set(alreadySeeded);
    const missing: string[] = [];

    for (const entry of EXTRACTED_PLUGINS) {
      if (alreadySeeded.has(entry.id)) continue;

      // Present already: either installed by hand or seeded before this record
      // existed. Mark it so we stop looking — no network access here.
      if (existsSync(join(pluginsDir, entry.directory))) {
        seeded.add(entry.id);
        continue;
      }

      // Turned off before the move: restoring it would override that choice.
      if ((config.disabledPlugins ?? []).includes(entry.id)) {
        seeded.add(entry.id);
        continue;
      }

      missing.push(entry.id);
    }

    const nextSeeded = [...seeded].sort();
    const previousSeeded = [...alreadySeeded].sort();
    if (nextSeeded.join() !== previousSeeded.join()) {
      await saveConfig({ ...config, seededPlugins: nextSeeded });
    }

    if (missing.length > 0) {
      log.info(
        `Extracted plugins not installed: ${missing.join(", ")}. `
        + `Install them explicitly with "gloomberb install <owner/repo>".`,
      );
    }
  } catch (error) {
    log.error(`Plugin restore skipped: ${error}`);
  }
}
