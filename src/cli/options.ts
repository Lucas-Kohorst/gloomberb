export type CliOutputFormat = "text" | "json" | "csv" | "ndjson";

export interface CliGlobalOptions {
  format: CliOutputFormat;
  quiet: boolean;
  color: boolean | null;
  limit?: number;
  refresh: boolean;
  dryRun: boolean;
  yes: boolean;
  dataDir?: string;
}

export interface ParsedCliArgs {
  args: string[];
  options: CliGlobalOptions;
}

export const DEFAULT_CLI_OPTIONS: CliGlobalOptions = {
  format: "text",
  quiet: false,
  color: null,
  refresh: false,
  dryRun: false,
  yes: false,
};

function parseLimit(value: string | undefined): number {
  if (!value) throw new Error("Missing value for --limit.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

/**
 * Early, pre-plugin/config parser for `--data-dir` / `--data-dir=<path>`.
 *
 * Runs before external plugins or the global config are loaded so that
 * `GLOOMBERB_DATA_DIR` is set in time for lazy resolvers (`getPluginsDir`,
 * `getDataDir`, `getAiRunsDir`). Intentionally silent on missing or
 * flag-like values — the full parser `parseCliGlobalArgs` will throw a
 * helpful "Missing value for --data-dir." error later.
 */
export function applyDataDirFromArgs(rawArgs: readonly string[]): void {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--data-dir") {
      const value = rawArgs[index + 1];
      if (value && !value.startsWith("-")) {
        process.env.GLOOMBERB_DATA_DIR = value;
      }
      return;
    }
    if (arg?.startsWith("--data-dir=")) {
      const value = arg.slice("--data-dir=".length);
      if (value) process.env.GLOOMBERB_DATA_DIR = value;
      return;
    }
  }
}

export function parseCliGlobalArgs(rawArgs: string[]): ParsedCliArgs {
  const options: CliGlobalOptions = { ...DEFAULT_CLI_OPTIONS };
  const args: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]!;
    if (arg === "--") {
      args.push(...rawArgs.slice(index + 1));
      break;
    }
    if (arg === "--json") {
      options.format = "json";
      continue;
    }
    if (arg === "--csv") {
      options.format = "csv";
      continue;
    }
    if (arg === "--ndjson") {
      options.format = "ndjson";
      continue;
    }
    if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
      continue;
    }
    if (arg === "--no-color") {
      options.color = false;
      continue;
    }
    if (arg === "--color") {
      options.color = true;
      continue;
    }
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }
    if (arg === "--limit") {
      index += 1;
      options.limit = parseLimit(rawArgs[index]);
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--data-dir") {
      index += 1;
      const value = rawArgs[index];
      if (!value) throw new Error("Missing value for --data-dir.");
      options.dataDir = value;
      process.env.GLOOMBERB_DATA_DIR = value;
      continue;
    }
    if (arg.startsWith("--data-dir=")) {
      const value = arg.slice("--data-dir=".length);
      if (!value) throw new Error("Missing value for --data-dir.");
      options.dataDir = value;
      process.env.GLOOMBERB_DATA_DIR = value;
      continue;
    }
    args.push(arg);
  }

  return { args, options };
}
