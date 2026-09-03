/**
 * Open every registered pane in a live TUI via remote control and scan the
 * pilotty snapshot for crash banners. Skip macro-tv. Requires a running
 * gloom-qa session whose HOME data dir is passed as --data-dir.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { sendRemoteControlRequest } from "../src/remote/client";
import type { RemoteControlRequest, RemoteControlResponse } from "../src/remote/types";

const ROOT = join(import.meta.dir, "..");
const ASSERTIONS = readFileSync(join(ROOT, "scripts/qa-assertions.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const SKIP_PANE_IDS = new Set(["macro-tv"]);
const SESSION = process.env.GLOOM_QA_SESSION ?? "gloom-qa";
const SETTLE_MS = Number(process.env.GLOOM_QA_PANE_SETTLE_MS ?? 700);

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function crashLines(text: string): string[] {
  const pattern = new RegExp(ASSERTIONS.join("|"), "i");
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => pattern.test(line));
}

function linesForPane(lines: string[], paneId: string): string[] {
  const needle = `"${paneId}"`;
  return lines.filter((line) => line.includes(needle) || line.includes(paneId));
}

function isHostCrash(lines: string[]): boolean {
  return lines.some((line) => /^(ReferenceError|TypeError|SyntaxError):/.test(line));
}

async function rpc(dataDir: string, request: RemoteControlRequest): Promise<RemoteControlResponse> {
  return sendRemoteControlRequest(request, { dataDir, appKind: "tui" });
}

async function snapshot(): Promise<string> {
  const proc = Bun.spawn(
    ["pilotty", "snapshot", "-s", SESSION, "--format", "text", "--settle", String(SETTLE_MS)],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0) throw new Error(`pilotty snapshot failed (${exit}): ${stderr.trim()}`);
  return stdout;
}

interface PaneType {
  id: string;
  name?: string;
}

const dataDir = argValue("--data-dir");
if (!dataDir) {
  console.error("qa-panes: pass --data-dir pointing at the isolated ~/.gloomberb");
  process.exit(2);
}

const only = (argValue("--only") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const onlySet = only.length > 0 ? new Set(only) : null;

const typesRes = await rpc(dataDir, { type: "get", resource: "app://pane-types" });
if (!typesRes.ok) {
  console.error("qa-panes: could not read app://pane-types", typesRes);
  process.exit(1);
}
const paneTypes = (typesRes.data as PaneType[]).filter((pane) => {
  if (SKIP_PANE_IDS.has(pane.id)) return false;
  if (onlySet && !onlySet.has(pane.id)) return false;
  return true;
});
if (onlySet) {
  const missing = [...onlySet].filter((id) => !paneTypes.some((pane) => pane.id === id));
  if (missing.length) {
    console.error(`qa-panes: unknown pane id(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}
console.log(`qa-panes: ${paneTypes.length} panes (skipped ${[...SKIP_PANE_IDS].join(", ")}${onlySet ? `; only ${only.join(",")}` : ""})`);

await rpc(dataDir, {
  type: "call",
  operation: "layout.new",
  input: { name: "qa-blank", activate: true, panes: [] },
});

const failures: Array<{ paneId: string; name?: string; lines: string[] }> = [];
const ok: string[] = [];
const rpcErrors: Array<{ paneId: string; error: string }> = [];
let hostCrash: string | null = null;

for (const pane of paneTypes) {
  if (hostCrash) break;
  let shown: RemoteControlResponse;
  try {
    shown = await rpc(dataDir, {
      type: "call",
      operation: "pane.show",
      input: { paneId: pane.id },
    });
  } catch (error) {
    hostCrash = error instanceof Error ? error.message : String(error);
    rpcErrors.push({ paneId: pane.id, error: hostCrash });
    break;
  }
  if (!shown.ok) {
    rpcErrors.push({ paneId: pane.id, error: shown.error.message });
    continue;
  }
  await Bun.sleep(200);
  const snap = await snapshot();
  const lines = crashLines(snap);
  if (isHostCrash(lines)) {
    hostCrash = lines.find((line) => /^(ReferenceError|TypeError|SyntaxError):/.test(line)) ?? lines[0]!;
    failures.push({ paneId: pane.id, name: pane.name, lines });
    console.log(`HOST ${pane.id}: ${hostCrash}`);
    break;
  }
  const mine = linesForPane(lines, pane.id);
  if (mine.length > 0) {
    failures.push({ paneId: pane.id, name: pane.name, lines: mine });
    console.log(`FAIL ${pane.id}${pane.name ? ` (${pane.name})` : ""}`);
    for (const line of mine) console.log(`  ${line}`);
  } else {
    ok.push(pane.id);
    console.log(`ok   ${pane.id}`);
  }
  await rpc(dataDir, {
    type: "call",
    operation: "pane.close",
    input: { paneId: pane.id },
  }).catch(() => {});
}

const dataProbes: RemoteControlRequest[] = [
  { type: "data", operation: "quote", symbol: "SPY" },
  { type: "data", operation: "articles.search", feed: "top", limit: 5 },
  { type: "data", operation: "markets.search", query: "fed", limit: 3 },
];
const dataFails: string[] = [];
if (!hostCrash) {
  for (const probe of dataProbes) {
    const label = "operation" in probe ? probe.operation : probe.type;
    try {
      const result = await rpc(dataDir, probe);
      if (!result.ok) {
        dataFails.push(`${label}: ${result.error.message}`);
        console.log(`DATA FAIL ${label}: ${result.error.message}`);
      } else {
        console.log(`DATA ok   ${label}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dataFails.push(`${label}: ${message}`);
      console.log(`DATA FAIL ${label}: ${message}`);
    }
  }
}

console.log("");
if (failures.length) {
  console.log("pane crashes:");
  for (const fail of failures) {
    console.log(`- ${fail.paneId}: ${fail.lines[0]}`);
  }
}
if (hostCrash) console.log(`host crash: ${hostCrash}`);
console.log(`ok=${ok.length} fail=${failures.length} rpcError=${rpcErrors.length} dataFail=${dataFails.length} remaining=${paneTypes.length - ok.length - failures.length - rpcErrors.length}`);
if (failures.length || rpcErrors.length || dataFails.length || hostCrash) {
  process.exit(1);
}
