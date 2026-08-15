import type { ByokDataFormat } from "./types";

export type ParsedByokPayload =
  | { kind: "table"; columns: string[]; rows: Record<string, string>[] }
  | { kind: "pairs"; pairs: Array<{ key: string; value: string }> }
  | { kind: "text"; text: string };

export function resolveByokDataFormat(declared: ByokDataFormat | undefined, contentType: string, body: string): Exclude<ByokDataFormat, "auto"> {
  if (declared && declared !== "auto") return declared;
  const type = contentType.toLowerCase();
  if (type.includes("json")) return "json";
  if (type.includes("csv")) return "csv";
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (looksLikeCsv(trimmed)) return "csv";
  return "text";
}

export function parseByokPayload(
  declared: ByokDataFormat | undefined,
  contentType: string,
  body: string,
): ParsedByokPayload {
  const format = resolveByokDataFormat(declared, contentType, body);
  if (format === "json") return parseJsonPayload(body);
  if (format === "csv") return parseCsvPayload(body);
  return { kind: "text", text: body };
}

function parseJsonPayload(body: string): ParsedByokPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "text", text: body };
  }
  if (Array.isArray(parsed)) {
    const records = parsed.filter((entry): entry is Record<string, unknown> => (
      !!entry && typeof entry === "object" && !Array.isArray(entry)
    ));
    if (records.length > 0) return tableFromRecords(records);
    return { kind: "text", text: JSON.stringify(parsed, null, 2) };
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const nested = firstRecordArray(record);
    if (nested) return tableFromRecords(nested);
    return {
      kind: "pairs",
      pairs: Object.entries(record).map(([key, value]) => ({
        key,
        value: formatJsonValue(value),
      })),
    };
  }
  return { kind: "text", text: JSON.stringify(parsed, null, 2) };
}

function firstRecordArray(record: Record<string, unknown>): Array<Record<string, unknown>> | null {
  for (const value of Object.values(record)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (value.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) {
      return value as Array<Record<string, unknown>>;
    }
  }
  return null;
}

function tableFromRecords(records: Array<Record<string, unknown>>): ParsedByokPayload {
  const columns: string[] = [];
  for (const record of records.slice(0, 40)) {
    for (const key of Object.keys(record)) {
      if (!columns.includes(key)) columns.push(key);
      if (columns.length >= 8) break;
    }
    if (columns.length >= 8) break;
  }
  return {
    kind: "table",
    columns,
    rows: records.map((record) => {
      const row: Record<string, string> = {};
      for (const column of columns) {
        row[column] = formatJsonValue(record[column]);
      }
      return row;
    }),
  };
}

function parseCsvPayload(body: string): ParsedByokPayload {
  const lines = body.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { kind: "text", text: body };
  const rows = lines.map(splitCsvLine);
  const columns = rows[0] ?? [];
  if (columns.length === 0) return { kind: "text", text: body };
  return {
    kind: "table",
    columns,
    rows: rows.slice(1).map((values) => {
      const row: Record<string, string> = {};
      columns.forEach((column, index) => {
        row[column] = values[index] ?? "";
      });
      return row;
    }),
  };
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function looksLikeCsv(body: string): boolean {
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes(",") && !firstLine.startsWith("<");
}

function formatJsonValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
