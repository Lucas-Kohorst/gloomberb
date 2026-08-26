import { join } from "path";
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync } from "fs";
import { getPluginsDir } from "../../loader";
import type { ExternalPluginEntry, OperationResult } from "./types";

const GITHUB_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validatePluginDirectoryName(name: string): string {
  if (!GITHUB_SEGMENT_PATTERN.test(name)) {
    throw new Error(`Invalid plugin name: ${name}.`);
  }
  return name;
}

function parseGitHubRef(rawRef: string): { url: string; name: string } {
  const ref = rawRef.startsWith("github:") ? rawRef.slice("github:".length) : rawRef;
  let segments: string[];
  if (ref.startsWith("https://")) {
    const parsed = new URL(ref);
    if (
      parsed.hostname !== "github.com"
      || parsed.port
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      throw new Error(`Invalid plugin reference: ${rawRef}. Use user/repo or a GitHub URL.`);
    }
    segments = parsed.pathname.split("/").filter(Boolean);
  } else if (!ref.includes("://")) {
    segments = ref.split("/");
  } else {
    segments = [];
  }
  const [owner, rawRepo] = segments;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (segments.length === 2 && owner && GITHUB_SEGMENT_PATTERN.test(owner) && repo) {
    const name = validatePluginDirectoryName(repo);
    return { url: `https://github.com/${owner}/${name}.git`, name };
  }
  throw new Error(`Invalid plugin reference: ${ref}. Use user/repo or a GitHub URL.`);
}

function isNativeRuntime(): boolean {
  return typeof Bun !== "undefined" && typeof Bun.spawn === "function";
}

async function runCommand(
  cmd: string[],
  options?: { cwd?: string },
): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stderr };
}

export function isPluginManagementAvailable(): boolean {
  return isNativeRuntime();
}

export async function installPluginAsync(ref: string): Promise<OperationResult> {
  if (!isNativeRuntime()) {
    return { name: "", success: false, message: "Plugin installation is not available in this environment." };
  }
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true });

  let parsed: { url: string; name: string };
  try {
    parsed = parseGitHubRef(ref);
  } catch (err) {
    return { name: "", success: false, message: err instanceof Error ? err.message : String(err) };
  }
  const { url, name } = parsed;
  const targetDir = join(pluginsDir, name);

  if (existsSync(targetDir)) {
    return {
      name,
      success: false,
      message: `Plugin "${name}" already exists. Use update to refresh it.`,
    };
  }

  const cloneResult = await runCommand(["git", "clone", "--depth", "1", url, targetDir]);
  if (cloneResult.exitCode !== 0) {
    try { rmSync(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { name, success: false, message: `Failed to clone ${url}.` };
  }

  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    await runCommand(["bun", "install"], { cwd: targetDir });
  }

  return {
    name,
    success: true,
    message: `Installed ${name}. It will be loaded automatically.`,
  };
}

export async function updatePluginAsync(name: string): Promise<OperationResult> {
  if (!isNativeRuntime()) {
    return { name, success: false, message: "Plugin updates are not available in this environment." };
  }
  const pluginsDir = getPluginsDir();
  const targetDir = join(pluginsDir, validatePluginDirectoryName(name));

  if (!existsSync(targetDir)) {
    return { name, success: false, message: `Plugin "${name}" was not found.` };
  }
  if (!existsSync(join(targetDir, ".git"))) {
    return { name, success: false, message: `"${name}" is not a git repository.` };
  }

  const pullResult = await runCommand(["git", "pull", "--ff-only"], { cwd: targetDir });
  if (pullResult.exitCode !== 0) {
    return { name, success: false, message: `Failed to update ${name}.` };
  }

  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    await runCommand(["bun", "install"], { cwd: targetDir });
  }

  return {
    name,
    success: true,
    message: `Updated ${name}. Changes will be applied automatically.`,
  };
}

export async function removePluginAsync(name: string): Promise<OperationResult> {
  if (!isNativeRuntime()) {
    return { name, success: false, message: "Plugin removal is not available in this environment." };
  }
  const pluginsDir = getPluginsDir();
  const targetDir = join(pluginsDir, validatePluginDirectoryName(name));

  if (!existsSync(targetDir)) {
    return { name, success: false, message: `Plugin "${name}" was not found.` };
  }

  rmSync(targetDir, { recursive: true, force: true });
  return { name, success: true, message: `Removed ${name}.` };
}

/**
 * Scans the external plugins directory without importing plugins.
 * Returns directory-level metadata (name, version, description) parsed
 * from each plugin's package.json when available.
 */
export function scanExternalPlugins(): ExternalPluginEntry[] {
  if (!isNativeRuntime()) return [];
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) return [];

  const entries = readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

  return entries.map((entry) => {
    const dir = join(pluginsDir, entry.name);
    let version = "—";
    let description = "—";
    let hasError = false;
    let pluginId: string | null = null;

    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        version = pkg.version || "—";
        description = pkg.description || "—";
      } catch {
        description = "Unreadable package.json";
        hasError = true;
      }
    }

    // Try to find the plugin ID by checking entry files for a default export name.
    // We avoid importing to keep the scan lightweight; the registry already has
    // loaded plugins. Instead, we match by directory name at the pane level.
    pluginId = null;

    return { dirName: entry.name, pluginId, version, description, hasError };
  });
}
