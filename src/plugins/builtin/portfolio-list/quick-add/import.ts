export interface BulkImportEntry {
  line: number;
  symbol: string;
  shares?: number;
  avgCost?: number;
}

export interface BulkImportFailure {
  line: number;
  symbol: string;
  reason: string;
}

export interface BulkImportParseResult {
  entries: BulkImportEntry[];
  failures: BulkImportFailure[];
  hasPositions: boolean;
}

export interface BulkImportResolution<T> {
  entry: BulkImportEntry;
  value?: T;
  failure?: BulkImportFailure;
}

function parsePositionRow(line: string, lineNumber: number): BulkImportEntry | BulkImportFailure {
  const fields = line.split(",").map((field) => field.trim());
  const symbol = fields[0]?.toUpperCase() ?? "";
  if (fields.length !== 3) {
    return { line: lineNumber, symbol, reason: "CSV rows require symbol, shares, and average cost" };
  }
  const shares = Number(fields[1]);
  if (!Number.isFinite(shares) || shares <= 0) {
    return { line: lineNumber, symbol, reason: "Shares must be greater than 0" };
  }
  const avgCost = Number(fields[2]);
  if (!Number.isFinite(avgCost)) {
    return { line: lineNumber, symbol, reason: "Average cost must be a valid number" };
  }
  if (!symbol) {
    return { line: lineNumber, symbol, reason: "Ticker symbol is required" };
  }
  return { line: lineNumber, symbol, shares, avgCost };
}

export function parseBulkImport(value: string, collectionKind: "portfolio" | "watchlist"): BulkImportParseResult {
  const entries: BulkImportEntry[] = [];
  const failures: BulkImportFailure[] = [];
  let hasPositions = false;

  for (const [index, rawLine] of value.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.split(",").map((field) => field.trim());
    const looksLikePosition = fields.length >= 3 || (fields.length === 2 && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(fields[1] ?? ""));

    if (looksLikePosition) {
      if (collectionKind !== "portfolio") {
        failures.push({ line: lineNumber, symbol: fields[0]?.toUpperCase() ?? "", reason: "Positions can only be imported into portfolios" });
        continue;
      }
      const parsed = parsePositionRow(line, lineNumber);
      if ("reason" in parsed) failures.push(parsed);
      else {
        entries.push(parsed);
        hasPositions = true;
      }
      continue;
    }

    for (const symbol of line.split(/[\s,]+/).map((entry) => entry.trim().toUpperCase()).filter(Boolean)) {
      entries.push({ line: lineNumber, symbol });
    }
  }

  return { entries, failures, hasPositions };
}

export async function resolveBulkImportEntries<T>(
  entries: BulkImportEntry[],
  resolve: (entry: BulkImportEntry) => Promise<{ value: T } | { reason: string }>,
): Promise<BulkImportResolution<T>[]> {
  const seen = new Set<string>();
  const results: BulkImportResolution<T>[] = [];
  for (const entry of entries) {
    if (seen.has(entry.symbol)) {
      results.push({
        entry,
        failure: { line: entry.line, symbol: entry.symbol, reason: "Duplicate symbol in import" },
      });
      continue;
    }
    seen.add(entry.symbol);
    const result = await resolve(entry);
    results.push("reason" in result
      ? { entry, failure: { line: entry.line, symbol: entry.symbol, reason: result.reason } }
      : { entry, value: result.value });
  }
  return results;
}
