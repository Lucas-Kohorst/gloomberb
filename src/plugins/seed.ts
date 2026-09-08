import { existsSync } from "fs";
import { join } from "path";

import type { AppConfig } from "../types/config";
import { debugLog } from "../utils/debug-log";
import { getPluginsDir } from "./loader";

const log = debugLog.createLogger("plugin-seed");

/**
 * Plugins that used to ship inside Gloomberb and now live in their own
 * repositories.
 *
 * Extracting one must not take a working feature away from someone who upgrades.
 * On first launch after the move, each of these is installed once, then recorded
 * so it is never reinstalled — including when the user removes it deliberately.
 *
 * Only repositories owned by the project organization (`gloom-sh`) are listed.
 * The old `Lucas-Kohorst/gloomberb-plugins` monorepo entry was removed: a
 * personal-account repository was a single-account trust anchor for an
 * unattended startup install/execute path (audit plugin-lifecycle-011).
 */
export const EXTRACTED_PLUGINS = [
  { id: "substack", repo: "gloom-sh/gloomberb-substack", directory: "gloomberb-substack" },
  { id: "ibkr", repo: "gloom-sh/gloomberb-ibkr", directory: "gloomberb-ibkr" },
  { id: "ibkr-gateway", repo: "gloom-sh/gloomberb-ibkr-gateway", directory: "gloomberb-ibkr-gateway" },
] as const;

/**
 * Environment variable that must be set to `"1"` for startup to auto-install
 * any extracted plugin over the network. Installing (and later importing) code
 * fetched from a remote repository at startup is a supply-chain execution
 * boundary, so it is disabled by default; the host should offer an explicit
 * consent/migration flow instead of silent background installs.
 */
export const AUTO_RESTORE_PLUGINS_ENV = "GLOOMBERB_AUTO_RESTORE_PLUGINS";

/** Only repositories owned by the project org may be auto-installed. */
const AUTO_RESTORE_ALLOWED_OWNER = "gloom-sh";

/** True when `repo` (e.g. "owner/name") may be auto-restored without consent. */
export function isAutoRestoreAllowedOwner(repo: string): boolean {
  return repo.startsWith(`${AUTO_RESTORE_ALLOWED_OWNER}/`);
}

export interface SeedResult {
  installed: string[];
  failed: string[];
  /** Ids to record as seeded, whether or not this launch installed them. */
  seeded: string[];
}

function isInstalled(directory: string, pluginsDir: string): boolean {
  return existsSync(join(pluginsDir, directory));
}

/**
 * Installs any extracted plugin the user has not seen yet.
 *
 * Best effort by design: a failure is logged and retried on the next launch
 * rather than recorded, because the common cause is being offline at startup and
 * marking it seeded would silently drop the plugin forever.
 *
 * Network installs only run when {@link AUTO_RESTORE_PLUGINS_ENV} is set to
 * "1" and every entry's repository belongs to the project org; otherwise
 * nothing is installed and nothing is recorded as seeded, so no state mutates.
 */
export async function seedExtractedPlugins(
  config: AppConfig,
  installPlugin: (ref: string) => Promise<void>,
  pluginsDir: string = getPluginsDir(),
): Promise<SeedResult> {
  const alreadySeeded = new Set(config.seededPlugins ?? []);
  const disabled = new Set(config.disabledPlugins ?? []);

  const result: SeedResult = { installed: [], failed: [], seeded: [...alreadySeeded] };

  // Startup auto-install of remote code is a supply-chain execution boundary.
  // Disabled unless the operator explicitly opts in; mark nothing as seeded so
  // a future opt-in run still gets a full restore.
  if (process.env[AUTO_RESTORE_PLUGINS_ENV] !== "1") {
    log.info(`Plugin auto-restore is disabled; set ${AUTO_RESTORE_PLUGINS_ENV}=1 to enable it.`);
    return result;
  }

  for (const entry of EXTRACTED_PLUGINS) {
    if (alreadySeeded.has(entry.id)) continue;

    // Present already: either installed by hand or seeded before this record
    // existed. Mark it so we stop looking.
    if (isInstalled(entry.directory, pluginsDir)) {
      result.seeded.push(entry.id);
      continue;
    }

    // Turned off before the move: restoring it would override that choice.
    if (disabled.has(entry.id)) {
      result.seeded.push(entry.id);
      continue;
    }

    // Only org-owned repositories are ever auto-installed. A personal or
    // third-party repo would expand the trust root beyond the project org
    // without user consent (audit plugin-lifecycle-011).
    if (!isAutoRestoreAllowedOwner(entry.repo)) {
      log.warn(
        `Skipping auto-restore of ${entry.id}: repo ${entry.repo} is not owned by ${AUTO_RESTORE_ALLOWED_OWNER}`,
      );
      continue;
    }

    try {
      log.info(`Restoring ${entry.id} from ${entry.repo}`);
      await installPlugin(entry.repo);
      result.installed.push(entry.id);
      result.seeded.push(entry.id);
    } catch (error) {
      log.error(`Could not restore ${entry.id}: ${error}`);
      result.failed.push(entry.id);
    }
  }

  return result;
}
