import { join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { getPluginsDir } from "../../plugins/loader";
import {
  cliStyles,
  renderSection,
  renderStat,
  renderTable,
} from "../../utils/cli-output";
import { fail } from "../errors";

const PLUGINS_DIR = getPluginsDir();

function ensurePluginsDir() {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
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

export async function installPlugin(ref: string) {
  ensurePluginsDir();
  const { url, name } = parseGitHubRef(ref);
  const targetDir = join(PLUGINS_DIR, name);

  if (existsSync(targetDir)) {
    fail(`Plugin "${name}" already exists.`, `Use "gloomberb update ${name}" to refresh it.`);
  }

  console.log(cliStyles.accent(`Installing ${name}`));
  console.log(cliStyles.muted(url));

  try {
    execFileSync("git", ["clone", "--depth", "1", url, targetDir], { stdio: "inherit" });
  } catch {
    rmSync(targetDir, { recursive: true, force: true });
    fail(`Failed to clone ${url}.`);
  }

  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    console.log(cliStyles.muted("Installing plugin dependencies..."));
    try {
      execFileSync("bun", ["install"], { cwd: targetDir, stdio: "inherit" });
    } catch {
      console.error(cliStyles.warning("Warning: failed to install plugin dependencies."));
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
        console.log(cliStyles.success(`Installed ${plugin.name} v${plugin.version || "0.0.0"}`));
        return;
      }
    }
    console.log(cliStyles.warning("Installed files, but no valid GloomPlugin export was found."));
  } catch (err) {
    console.log(cliStyles.warning(`Plugin validation failed: ${err}`));
  }
}

export async function removePlugin(name: string) {
  const targetDir = join(PLUGINS_DIR, validatePluginDirectoryName(name));
  if (!existsSync(targetDir)) {
    fail(`Plugin "${name}" was not found.`, PLUGINS_DIR);
  }
  rmSync(targetDir, { recursive: true, force: true });
  console.log(cliStyles.success(`Removed plugin "${name}".`));
}

export async function updatePlugins(name?: string) {
  ensurePluginsDir();
  const dirs = name
    ? [validatePluginDirectoryName(name)]
    : readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

  if (dirs.length === 0) {
    console.log(cliStyles.muted("No plugins installed."));
    return;
  }

  for (const dir of dirs) {
    const targetDir = join(PLUGINS_DIR, dir);
    if (!existsSync(join(targetDir, ".git"))) {
      console.log(cliStyles.warning(`Skipping ${dir} (not a git repo)`));
      continue;
    }
    console.log(cliStyles.accent(`Updating ${dir}...`));
    try {
      execFileSync("git", ["pull", "--ff-only"], { cwd: targetDir, stdio: "inherit" });
      const pkgPath = join(targetDir, "package.json");
      if (existsSync(pkgPath)) {
        execFileSync("bun", ["install"], { cwd: targetDir, stdio: "inherit" });
      }
    } catch {
      console.error(cliStyles.danger(`Failed to update ${dir}.`));
    }
  }
}

export function listPlugins() {
  ensurePluginsDir();
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  if (entries.length === 0) {
    console.log(cliStyles.muted("No plugins installed."));
    console.log(cliStyles.muted("Install one with: gloomberb install <github-user/repo>"));
    return;
  }

  const rows = entries.map((entry) => {
    const dir = join(PLUGINS_DIR, entry.name);
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
  console.log(renderStat("Directory", PLUGINS_DIR));
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
  return `import type { GloomPlugin } from "gloomberb/types/plugin";

export const ${varName}: GloomPlugin = {
  id: "${name}",
  name: "${displayName}",
  version: "0.1.0",
  description: "A new Gloomberb plugin.",
  toggleable: true,
  setup(ctx) {
    // Register panes, commands, columns, etc.
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
  console.log(cliStyles.muted("Restart the app after editing to load your plugin."));
}

export async function validatePlugin(name: string) {
  validatePluginDirectoryName(name);
  const targetDir = join(PLUGINS_DIR, name);
  if (!existsSync(targetDir)) {
    fail(`Plugin "${name}" was not found.`, PLUGINS_DIR);
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
