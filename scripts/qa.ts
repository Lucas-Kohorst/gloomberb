/**
 * Local CI for Gloomberb.
 *
 *   bun run qa              tests for this checkout's changes + CLI data shape + TUI boot
 *   bun run qa --fast       skip live TUI / pilotty
 *   bun run qa --live       TUI boot + pane.show (marketplace plus changed panes; --all-panes for every pane)
 *   bun run qa --hook       default pre-push: tests + CLI (set GLOOM_QA_LIVE=1 for TUI)
 *   bun run qa --offline    skip network CLI probes
 *
 * Live TUI uses the existing qa-tui / qa-panes scripts. Never opens TV.
 * The pre-push hook is installed by bun install (prepare). It is not opt-in.
 */
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ALWAYS_FN,
  ALWAYS_TESTS,
  checkCatalogEntries,
  checkCliEnvelope,
  checkPaneReport,
  checkTickerData,
  planFromFiles,
  type QaPlan,
} from "./qa-lib";

const ROOT = join(import.meta.dir, "..");

interface Flags {
  fast: boolean;
  live: boolean;
  hook: boolean;
  offline: boolean;
  allPanes: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): Flags {
  const hook = argv.includes("--hook") || process.env.GLOOM_QA_HOOK === "1";
  const liveEnv = process.env.GLOOM_QA_LIVE === "1";
  return {
    fast: argv.includes("--fast") || (hook && !liveEnv),
    live: argv.includes("--live") || liveEnv,
    hook,
    offline: argv.includes("--offline"),
    allPanes: argv.includes("--all-panes"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`Gloomberb local CI

Usage: bun run qa [--fast] [--live] [--all-panes] [--offline] [--hook]

Always (and on every git push via the default pre-push hook):
  - bun test on files related to this checkout (working tree + commits since local main)
  - catalog-ui duplicate-pane guard
  - plugin-marketplace catalog merge/sort (nameless plugins must not crash)
  - CLI JSON probes (ticker + pane fn) with shape invariants

Live (pilotty, skipped by --fast / --hook unless GLOOM_QA_LIVE=1):
  - TUI boot snapshot (crash banners fail)
  - pane.show for plugin-marketplace plus changed pane ids (or every pane with --all-panes)
  - remote quote / news / markets probes

The hook is installed by bun install. Reinstall with: bun run qa:install-hook
`);
}

function gitLines(args: string[]): string[] {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return [];
  return new TextDecoder().decode(proc.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitRev(ref: string): string | null {
  return gitLines(["rev-parse", "--verify", ref])[0] ?? null;
}

/** This checkout's integration branch. Never a foreign remote such as gloomsh/main. */
function localIntegrationRef(): string | null {
  if (gitRev("main")) return "main";
  if (gitRev("origin/main")) return "origin/main";
  return null;
}

function changedFiles(): string[] {
  const files = new Set<string>();
  for (const line of [
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]) {
    files.add(line);
  }
  const integration = localIntegrationRef();
  const head = gitRev("HEAD");
  if (integration && head) {
    const base = gitLines(["merge-base", "HEAD", integration])[0];
    if (base && base !== head) {
      for (const line of gitLines(["diff", "--name-only", `${base}...HEAD`])) files.add(line);
    }
  }
  return [...files].filter((file) => (
    !file.startsWith("plans/")
    && !file.startsWith("wx/")
    && !file.endsWith(".md")
    && file !== "worker-configuration.d.ts"
  ));
}

function which(bin: string): boolean {
  const proc = Bun.spawnSync(["bash", "-lc", `command -v ${bin}`], { stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0;
}

async function run(command: string[], options: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = options.timeoutMs
    ? setTimeout(() => proc.kill(), options.timeoutMs)
    : null;
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timeout) clearTimeout(timeout);
  return { exit, stdout, stderr };
}

function failStep(name: string, detail: string): never {
  console.error(`qa FAIL ${name}: ${detail}`);
  process.exit(1);
}

function writeIsolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "gloom-qa-home-"));
  const dataDir = join(home, ".gloomberb");
  mkdirSync(dataDir, { recursive: true });
  return home;
}

async function seedConfig(home: string): Promise<void> {
  const result = await run([
    "bun",
    "-e",
    `
      import { mkdirSync, writeFileSync } from "fs";
      import { join } from "path";
      import { createDefaultConfig } from "./src/types/config";
      const dir = join(process.env.HOME, ".gloomberb");
      mkdirSync(dir, { recursive: true });
      const config = createDefaultConfig(dir);
      config.onboardingComplete = true;
      // Isolated QA homes must not clone extracted plugins from GitHub.
      config.seededPlugins = ["substack", "ibkr", "ibkr-gateway"];
      writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    `,
  ], { env: { HOME: home }, timeoutMs: 30_000 });
  if (result.exit !== 0) {
    failStep("seed-config", result.stderr || result.stdout);
  }
}

async function gloomberbJson(home: string, args: string[]): Promise<unknown> {
  const result = await run(
    ["bun", "src/index.tsx", "--json", ...args],
    { env: { HOME: home }, timeoutMs: 90_000 },
  );
  const output = result.stdout.trim() || result.stderr.trim();
  if (result.exit !== 0) {
    throw new Error(`${args.join(" ")} exited ${result.exit}: ${output.slice(0, 400)}`);
  }
  try {
    return parseJsonPayload(output);
  } catch {
    throw new Error(`${args.join(" ")} did not print JSON: ${output.slice(0, 400)}`);
  }
}

function parseJsonPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.lastIndexOf("{");
    const arrayStart = text.lastIndexOf("[");
    const start = Math.max(objectStart, arrayStart);
    if (start < 0) throw new Error("no JSON payload");
    return JSON.parse(text.slice(start));
  }
}

async function runTests(plan: QaPlan): Promise<void> {
  const targets = plan.tests.length > 0 ? plan.tests : ALWAYS_TESTS;
  console.log(`qa tests: ${targets.join(" ")}`);
  const result = await run(["bun", "test", ...targets], { timeoutMs: 180_000 });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.exit !== 0) failStep("tests", `bun test exited ${result.exit}`);
}

async function runData(plan: QaPlan, offline: boolean): Promise<void> {
  if (offline) {
    console.log("qa data: skipped (--offline)");
    return;
  }
  const home = writeIsolatedHome();
  await seedConfig(home);
  console.log("qa data: ticker SPY");
  const ticker = checkCliEnvelope(await gloomberbJson(home, ["ticker", "SPY"]));
  checkTickerData(ticker.data);

  console.log("qa data: catalog");
  const catalog = checkCliEnvelope(await gloomberbJson(home, ["catalog", "--limit", "30"]));
  checkCatalogEntries(catalog.data);

  const fnTokens = [...new Set([...ALWAYS_FN, ...plan.fn])];
  for (const token of fnTokens) {
    const args = ["fn", ...token.split(" ").filter(Boolean)];
    console.log(`qa data: ${args.join(" ")}`);
    try {
      const report = checkCliEnvelope(await gloomberbJson(home, args));
      checkPaneReport(report.data, {
        allowEmpty: token.startsWith("prediction-markets") || token === "VAL" || token === "ECO" || token === "ECST",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not a verified bot-safe|Unknown|Could not resolve/i.test(message)) {
        console.log(`qa data skip ${token}: ${message.split("\n")[0]}`);
        continue;
      }
      throw error;
    }
  }
  console.log("qa data: pass");
}

async function runLive(plan: QaPlan, allPanes: boolean): Promise<void> {
  if (!which("pilotty")) {
    console.log("qa live: skipped (pilotty not on PATH). Install with: npm i -g pilotty");
    return;
  }
  console.log("qa live: TUI boot");
  const tui = await run(["bash", "scripts/qa-tui.sh"], { timeoutMs: 90_000 });
  process.stdout.write(tui.stdout);
  if (tui.stderr) process.stderr.write(tui.stderr);
  if (tui.exit !== 0) failStep("tui", `qa-tui exited ${tui.exit}`);

  if (!allPanes && plan.panes.length === 0) {
    console.log("qa live: pane.show skipped (no mapped pane ids; pass --all-panes to open every pane)");
    console.log("qa live: pass");
    return;
  }
  const paneArgs = allPanes ? [] : ["--only", plan.panes.join(",")];
  console.log(`qa live: panes ${allPanes ? "(all)" : plan.panes.join(",")}`);
  const panes = await run(["bash", "scripts/qa-panes.sh", ...paneArgs], { timeoutMs: 600_000 });
  process.stdout.write(panes.stdout);
  if (panes.stderr) process.stderr.write(panes.stderr);
  if (panes.exit !== 0) failStep("panes", `qa-panes exited ${panes.exit}`);
  console.log("qa live: pass");
}

const flags = parseFlags(process.argv.slice(2));
if (flags.help) {
  printHelp();
  process.exit(0);
}

const files = changedFiles();
const plan = planFromFiles(ROOT, files);
console.log(`qa files: ${files.length === 0 ? "(working tree clean vs merge-base)" : files.slice(0, 20).join(", ")}${files.length > 20 ? ` +${files.length - 20}` : ""}`);
console.log(`qa panes: ${plan.panes.join(", ") || "(none mapped)"}`);

try {
  await runTests(plan);
  await runData(plan, flags.offline);
  const wantLive = flags.live || (!flags.fast && !flags.hook);
  if (wantLive) await runLive(plan, flags.allPanes);
  console.log("qa: pass");
} catch (error) {
  failStep("data", error instanceof Error ? error.message : String(error));
}
