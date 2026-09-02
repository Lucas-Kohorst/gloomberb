import { join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getPluginsDir } from "../../plugins/loader";
import { linkHostPackages } from "../../plugins/host-link";
import {
  cliStyles,
  renderSection,
  renderStat,
  renderTable,
} from "../../utils/cli-output";
import { fail } from "../errors";

function ensurePluginsDir() {
  if (!existsSync(getPluginsDir())) {
    mkdirSync(getPluginsDir(), { recursive: true });
  }
}

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
    if (parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
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

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Resolves a bare plugin id through the registry, so `gloomberb install
 * hackernews` works alongside `gloomberb install owner/repo`. Anything already
 * shaped like a repo reference is left alone, and a registry lookup failure
 * falls through to the normal parse error rather than inventing a repo name.
 */
async function resolveRegistryRef(rawRef: string): Promise<string> {
  if (rawRef.includes("/") || rawRef.includes(":") || !PLUGIN_ID_PATTERN.test(rawRef)) return rawRef;

  try {
    const response = await fetch(`https://plugins.gloom.sh/plugins/${rawRef}.json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return rawRef;
    const entry = await response.json() as { repo?: string; bundled?: boolean; name?: string };

    if (entry.bundled) {
      fail(
        `"${entry.name ?? rawRef}" ships with Gloomberb.`,
        `Enable it from the plugin marketplace (PL) instead.`,
      );
    }
    if (typeof entry.repo === "string" && entry.repo.length > 0) {
    
      return entry.repo;
    }
  } catch {
    // Offline or registry down: fall through so the plain parse error explains
    // the accepted formats rather than blaming the network.
  }
  return rawRef;
}

export interface InstallPluginOptions {
  /**
   * Suppress child-process output and progress logging. The marketplace pane
   * installs while the terminal UI owns the screen, and git and bun writing to
   * stdout corrupts the rendered frame.
   */
  quiet?: boolean;
}

export async function installPlugin(rawRef: string, options: InstallPluginOptions = {}) {
  const stdio = options.quiet ? "pipe" : "inherit";
  const say = (message: string) => {
    if (!options.quiet) console.log(message);
  };
  ensurePluginsDir();
  const ref = await resolveRegistryRef(rawRef);
  const { url, name } = parseGitHubRef(ref);
  const targetDir = join(getPluginsDir(), name);

  if (existsSync(targetDir)) {
    fail(`Plugin "${name}" already exists.`, `Use "gloomberb update ${name}" to refresh it.`);
  }

  say(cliStyles.accent(`Installing ${name}`));
  say(cliStyles.muted(url));

  try {
    execFileSync("git", ["clone", "--depth", "1", url, targetDir], { stdio });
  } catch {
    rmSync(targetDir, { recursive: true, force: true });
    fail(`Failed to clone ${url}.`);
  }

  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    say(cliStyles.muted("Installing plugin dependencies..."));
    try {
      // --production: plugin repos depend on `gloomberb` as a devDependency so
      // their own CI can typecheck against the real API. At runtime the host is
      // symlinked in instead, and pulling a second full copy here would both
      // waste a lot of disk and risk a duplicate React.
      execFileSync("bun", ["install", "--production"], { cwd: targetDir, stdio });
    } catch {
      if (!options.quiet) console.error(cliStyles.warning("Warning: failed to install plugin dependencies."));
    }
  }

  // After `bun install`, which prunes links it does not know about.
  const link = linkHostPackages(targetDir);
  if (link.error) {
    if (!options.quiet) {
      console.error(cliStyles.warning(`Warning: could not link the Gloomberb runtime (${link.error}).`));
      console.error(cliStyles.muted("The plugin's \"gloomberb/*\" imports will not resolve."));
    }
  }

  try {
    let entryFile: string | null = null;
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      if (pkg.main) entryFile = join(targetDir, pkg.main);
    }
    if (!entryFile) {
      for (const candidate of ["index.ts", "index.tsx", "index.js"]) {
        const path = join(targetDir, candidate);
        if (existsSync(path)) {
          entryFile = path;
          break;
        }
      }
    }
    if (entryFile) {
      const mod = await import(entryFile);
      const plugin = mod.default ?? mod.plugin;
      if (plugin?.id && plugin?.name) {
        say(cliStyles.success(`Installed ${plugin.name} v${plugin.version || "0.0.0"}`));
        return;
      }
    }
    say(cliStyles.warning("Installed files, but no valid GloomPlugin export was found."));
  } catch (err) {
    say(cliStyles.warning(`Plugin validation failed: ${err}`));
  }
}

export async function removePlugin(name: string) {
  const targetDir = join(getPluginsDir(), validatePluginDirectoryName(name));
  if (!existsSync(targetDir)) {
    fail(`Plugin "${name}" was not found.`, getPluginsDir());
  }
  rmSync(targetDir, { recursive: true, force: true });
  console.log(cliStyles.success(`Removed plugin "${name}".`));
}

export async function updatePlugins(name?: string) {
  ensurePluginsDir();
  const dirs = name
    ? [validatePluginDirectoryName(name)]
    : readdirSync(getPluginsDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

  if (dirs.length === 0) {
    console.log(cliStyles.muted("No plugins installed."));
    return;
  }

  for (const dir of dirs) {
    const targetDir = join(getPluginsDir(), dir);
    if (!existsSync(join(targetDir, ".git"))) {
      console.log(cliStyles.warning(`Skipping ${dir} (not a git repo)`));
      continue;
    }
    console.log(cliStyles.accent(`Updating ${dir}...`));
    try {
      execFileSync("git", ["pull", "--ff-only"], { cwd: targetDir, stdio: "inherit" });
      const pkgPath = join(targetDir, "package.json");
      if (existsSync(pkgPath)) {
        execFileSync("bun", ["install", "--production"], { cwd: targetDir, stdio: "inherit" });
      }
      linkHostPackages(targetDir);
    } catch {
      console.error(cliStyles.danger(`Failed to update ${dir}.`));
    }
  }
}

export function listPlugins() {
  ensurePluginsDir();
  const entries = readdirSync(getPluginsDir(), { withFileTypes: true }).filter((entry) => entry.isDirectory());

  if (entries.length === 0) {
    console.log(cliStyles.muted("No plugins installed."));
    console.log(cliStyles.muted("Install one with: gloomberb install <github-user/repo>"));
    return;
  }

  const rows = entries.map((entry) => {
    const dir = join(getPluginsDir(), entry.name);
    let version = "—";
    let description = "—";
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        version = pkg.version || "—";
        description = pkg.description || "—";
      } catch {
        description = "Unreadable package.json";
      }
    }
    return [entry.name, version, description];
  });

  console.log(renderSection("Installed Plugins"));
  console.log(renderTable(
    [
      { header: "Plugin" },
      { header: "Version" },
      { header: "Description" },
    ],
    rows,
  ));
  console.log("");
  console.log(renderStat("Directory", getPluginsDir()));
}

export async function searchPlugins(query: string) {
  const baseUrl = new URL("https://api.github.com/search/repositories");
  baseUrl.searchParams.set("sort", "stars");
  baseUrl.searchParams.set("order", "desc");
  baseUrl.searchParams.set("per_page", "20");

  async function fetchResults(q: string) {
    const url = new URL(baseUrl);
    url.searchParams.set("q", q);
    const res = await fetch(url.toString(), {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "gloomberb",
      },
    });
    if (!res.ok) {
      fail(`GitHub search failed: ${res.status}`);
    }
    const data = await res.json() as {
      items: Array<{
        full_name: string;
        description: string | null;
        stargazers_count: number;
        html_url: string;
      }>;
    };
    return data.items;
  }

  let items = await fetchResults(`${query} topic:gloomberb-plugin`);
  if (items.length === 0) {
    items = await fetchResults(`${query} gloomberb in:name,description`);
  }

  if (items.length === 0) {
    console.log(cliStyles.muted(`No plugins found for "${query}".`));
    console.log(cliStyles.muted("Try a different keyword, or install directly with: gloomberb install <user/repo>"));
    return;
  }

  console.log(renderSection("Plugin Search Results"));
  const rows = items.map((item) => [
    item.full_name,
    String(item.stargazers_count),
    item.description ?? "—",
  ]);
  console.log(renderTable(
    [
      { header: "Plugin" },
      { header: "Stars" },
      { header: "Description" },
    ],
    rows,
  ));
  console.log("");
  console.log(cliStyles.muted("Install with: gloomberb install <user/repo>"));
}

export function toDisplayName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toVariableName(name: string): string {
  const parts = name.split("-").filter(Boolean);
  if (parts.length === 0) return "myPlugin";
  const first = parts[0]!.toLowerCase();
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return [first, ...rest].join("");
}

export function buildPluginIndexContent(name: string): string {
  const varName = toVariableName(name);
  const displayName = toDisplayName(name);
  const shortcut = name.replace(/-/g, "").slice(0, 4).toUpperCase() || "PANE";
  return `import type { GloomPlugin } from "gloomberb/types/plugin";

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "A new Gloomberb plugin.",
  toggleable: true,
  panes: [{
    id: "${name}",
    name: "${displayName}",
    icon: "P",
    component: () => null,
  }],
  paneTemplates: [{
    id: "${name}-pane",
    paneId: "${name}",
    label: "${displayName}",
    description: "${displayName} pane. Open with pane.createFromTemplate ${name}-pane.",
    keywords: ["${name}"],
    shortcut: { prefix: "${shortcut}" },
  }],
  setup(ctx) {
    ctx.registerAgentPromptFragment(
      "${displayName}: pane.createFromTemplate ${name}-pane (${shortcut}).",
    );
    // Unique data the remote inventory does not already cover:
    // ctx.registerAgentTool({ name: "${name.replace(/-/g, "_")}_lookup", ... });
  },
};

export default ${varName};
`;
}

export function buildPluginPackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      description: "A new Gloomberb plugin.",
      main: "index.ts",
    },
    null,
    2,
  ) + "\n";
}

export function scaffoldPlugin(name: string) {
  validatePluginDirectoryName(name);
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }
  const targetDir = join(pluginsDir, name);

  if (existsSync(targetDir)) {
    fail(`Plugin "${name}" already exists.`, pluginsDir);
  }

  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "index.ts"), buildPluginIndexContent(name));
  writeFileSync(join(targetDir, "package.json"), buildPluginPackageJson(name));

  console.log(cliStyles.success(`Scaffolded plugin "${name}"`));
  console.log(renderStat("Path", targetDir));
  console.log("");
  console.log(cliStyles.muted(`Edit ${join(targetDir, "index.ts")} to start building.`));
  console.log(cliStyles.muted("Native reloads the plugin as soon as it compiles."));
}

export async function validatePlugin(name: string) {
  validatePluginDirectoryName(name);
  const targetDir = join(getPluginsDir(), name);
  if (!existsSync(targetDir)) {
    fail(`Plugin "${name}" was not found.`, getPluginsDir());
  }

  let entryFile: string | null = null;
  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.main) entryFile = join(targetDir, pkg.main);
    } catch { /* ignore malformed package.json */ }
  }
  if (!entryFile) {
    for (const candidate of ["index.ts", "index.tsx", "index.js"]) {
      const p = join(targetDir, candidate);
      if (existsSync(p)) { entryFile = p; break; }
    }
  }

  if (!entryFile) {
    fail(`No entry file found for plugin "${name}".`, targetDir);
  }

  try {
    const mod = await import(entryFile);
    const plugin = mod.default ?? mod.plugin;
    if (!plugin) {
      fail(`Plugin "${name}" has no default export or named "plugin" export.`, entryFile);
    }
    if (!plugin.id || typeof plugin.id !== "string") {
      fail(`Plugin "${name}" is missing a valid "id" field.`, entryFile);
    }
    if (!plugin.name || typeof plugin.name !== "string") {
      fail(`Plugin "${name}" is missing a valid "name" field.`, entryFile);
    }
    console.log(cliStyles.success(`Valid: ${plugin.name} v${plugin.version || "0.0.0"}`));
    console.log(renderStat("ID", plugin.id));
    console.log(renderStat("Entry", entryFile));
  } catch (err) {
    fail(`Failed to load plugin "${name}": ${err instanceof Error ? err.message : String(err)}`, entryFile);
  }
}
