import { existsSync } from "fs";
import { join } from "path";

export interface PathRule {
  match: RegExp;
  panes: string[];
  tests: string[];
  /** `gloomberb --json fn …` tokens. Empty when the pane has no bot-safe report. */
  fn: string[];
}

export const ALWAYS_TESTS = [
  "src/plugins/catalog-ui.test.ts",
  "src/plugins/builtin/plugin-marketplace/model.test.ts",
];

/** Live pane.show always opens these, even when the diff did not touch them. */
export const ALWAYS_PANES = [
  "plugin-marketplace",
];

export const PATH_RULES: PathRule[] = [
  {
    match: /^src\/plugins\/prediction-markets\//,
    panes: ["prediction-markets"],
    tests: ["src/plugins/prediction-markets"],
    fn: ["prediction-markets"],
  },
  {
    match: /^src\/plugins\/builtin\/chart-composer\//,
    panes: ["chart-composer"],
    tests: ["src/plugins/builtin/chart-composer"],
    fn: ["graph-price-pane AAPL"],
  },
  {
    match: /^src\/time-series\//,
    panes: ["chart-composer"],
    tests: ["src/time-series", "src/plugins/builtin/chart-composer/presets.test.ts"],
    fn: ["graph-price-pane AAPL"],
  },
  {
    match: /^src\/components\/chart\//,
    panes: ["chart-composer"],
    tests: ["src/components/chart"],
    fn: ["graph-price-pane AAPL"],
  },
  {
    match: /^src\/plugins\/builtin\/market-valuation\//,
    panes: ["market-valuation"],
    tests: ["src/plugins/builtin/market-valuation"],
    fn: ["VAL"],
  },
  {
    match: /^src\/plugins\/builtin\/econ-statistics\//,
    panes: ["econ-statistics"],
    tests: ["src/plugins/builtin/econ-statistics"],
    fn: ["ECST"],
  },
  {
    match: /^src\/plugins\/builtin\/econ\//,
    panes: ["econ-calendar"],
    tests: ["src/plugins/builtin/econ"],
    fn: ["ECO"],
  },
  {
    match: /^src\/plugins\/builtin\/research-search\//,
    panes: ["research-search"],
    tests: ["src/plugins/builtin/research-search"],
    fn: [],
  },
  {
    match: /^src\/plugins\/builtin\/plugin-marketplace\//,
    panes: ["plugin-marketplace"],
    tests: ["src/plugins/builtin/plugin-marketplace"],
    fn: [],
  },
  {
    match: /^src\/plugins\/catalog-ui/,
    panes: [],
    tests: ["src/plugins/catalog-ui.test.ts"],
    fn: [],
  },
  {
    match: /^src\/components\/sign-in-gate/,
    panes: [],
    tests: ["src/components/sign-in-gate.test.tsx"],
    fn: [],
  },
  {
    match: /^src\/components\/command-bar\//,
    panes: [],
    tests: ["src/components/command-bar"],
    fn: [],
  },
  {
    match: /^src\/components\/ui\/data-table\//,
    panes: [],
    tests: ["src/components/ui/data-table"],
    fn: [],
  },
  {
    match: /^src\/components\/layout\//,
    panes: [],
    tests: ["src/components/layout"],
    fn: [],
  },
];

export const ALWAYS_FN = [
  "graph-price-pane AAPL",
];

export interface QaPlan {
  files: string[];
  tests: string[];
  panes: string[];
  fn: string[];
}

export function siblingTestPath(file: string): string | null {
  const tsx = file.replace(/\.tsx$/, ".test.tsx");
  if (tsx !== file) return tsx;
  const ts = file.replace(/\.ts$/, ".test.ts");
  return ts !== file ? ts : null;
}

export function resolveExistingTests(root: string, candidates: readonly string[]): string[] {
  const resolved: string[] = [];
  for (const candidate of candidates) {
    const abs = join(root, candidate);
    if (existsSync(abs)) resolved.push(candidate);
  }
  return [...new Set(resolved)];
}

export function planFromFiles(root: string, files: readonly string[]): QaPlan {
  const tests = new Set<string>(ALWAYS_TESTS);
  const panes = new Set<string>(ALWAYS_PANES);
  const fn = new Set<string>(ALWAYS_FN);

  for (const file of files) {
    const sibling = siblingTestPath(file);
    if (sibling) tests.add(sibling);
    for (const rule of PATH_RULES) {
      if (!rule.match.test(file)) continue;
      for (const pane of rule.panes) panes.add(pane);
      for (const test of rule.tests) tests.add(test);
      for (const token of rule.fn) fn.add(token);
    }
  }

  return {
    files: [...files],
    tests: resolveExistingTests(root, [...tests]),
    panes: [...panes],
    fn: [...fn],
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function checkCliEnvelope(parsed: unknown): { ok: true; data: unknown } {
  if (!isRecord(parsed) || parsed.ok !== true) {
    throw new Error(`CLI envelope missing ok:true (${summarize(parsed)})`);
  }
  if (!("data" in parsed)) {
    throw new Error("CLI envelope missing data");
  }
  return { ok: true, data: parsed.data };
}

export function checkTickerData(data: unknown): void {
  if (!isRecord(data)) throw new Error("ticker data is not an object");
  if (typeof data.symbol !== "string" || data.symbol.trim().length === 0) {
    throw new Error("ticker.symbol missing");
  }
  if (!isRecord(data.quote)) {
    throw new Error(`ticker ${data.symbol} has no quote`);
  }
  if (typeof data.quote.symbol !== "string" || data.quote.symbol.trim().length === 0) {
    throw new Error("quote.symbol missing");
  }
  if (typeof data.quote.price !== "number" || !Number.isFinite(data.quote.price) || data.quote.price <= 0) {
    throw new Error(`quote.price is not a positive finite number (${String(data.quote.price)})`);
  }
  if (typeof data.quote.changePercent !== "number" || !Number.isFinite(data.quote.changePercent)) {
    throw new Error("quote.changePercent is not finite");
  }
}

export function checkPaneReport(data: unknown, options: { allowEmpty?: boolean } = {}): void {
  if (!isRecord(data)) throw new Error("pane report is not an object");
  for (const key of ["kind", "target", "capabilityId"] as const) {
    if (typeof data[key] !== "string" || data[key].trim().length === 0) {
      throw new Error(`pane report.${key} missing`);
    }
  }
  if (typeof data.rowCount !== "number" || !Number.isFinite(data.rowCount) || data.rowCount < 0) {
    throw new Error(`pane report.rowCount invalid (${String(data.rowCount)})`);
  }
  if (typeof data.empty !== "boolean") throw new Error("pane report.empty missing");
  if (typeof data.complete !== "boolean") throw new Error("pane report.complete missing");
  if (!Array.isArray(data.unavailableSymbols)) {
    throw new Error("pane report.unavailableSymbols missing");
  }
  if (data.empty !== (data.rowCount === 0)) {
    throw new Error(`pane report empty=${String(data.empty)} disagrees with rowCount=${data.rowCount}`);
  }
  if (
    !options.allowEmpty
    && data.empty
    && data.complete
    && data.unavailableSymbols.length === 0
  ) {
    throw new Error(
      `pane report ${data.target} claims complete success with zero rows`,
    );
  }
}

export function checkCatalogEntries(data: unknown): void {
  const entries = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.entries)
      ? data.entries
      : null;
  if (!entries) throw new Error("catalog data is not a list of entries");
  if (entries.length === 0) throw new Error("catalog is empty");
  for (const entry of entries.slice(0, 20)) {
    if (!isRecord(entry)) throw new Error("catalog entry is not an object");
    if (typeof entry.token !== "string" && typeof entry.paneId !== "string") {
      throw new Error(`catalog entry missing token/paneId (${summarize(entry)})`);
    }
  }
}

function summarize(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 180);
  } catch {
    return String(value);
  }
}
