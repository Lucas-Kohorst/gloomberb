import type { ByokAuthType, ByokOpenApiOperation } from "./types";

export class ByokOpenApiError extends Error {
  constructor(message: string, public readonly kind: "parse" | "servers" | "probe") {
    super(message);
    this.name = "ByokOpenApiError";
  }
}

type AnyRecord = Record<string, any>;
export interface ParsedByokOpenApi {
  baseUrl: string;
  authType?: ByokAuthType;
  authKey?: string;
  operations: ByokOpenApiOperation[];
  probe: ByokOpenApiOperation;
}

function exampleFor(parameter: AnyRecord): string | undefined {
  const schema = parameter.schema ?? {};
  const value = parameter.example ?? parameter.default ?? schema.example ?? schema.default ?? parameter.enum?.[0] ?? schema.enum?.[0];
  return value == null ? undefined : String(value);
}

function operationParameters(spec: AnyRecord, pathItem: AnyRecord, operation: AnyRecord): AnyRecord[] {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((p) =>
    p.$ref?.startsWith("#/parameters/") ? spec.parameters?.[p.$ref.split("/").pop()!] ?? p : p,
  );
}

function serverUrl(spec: AnyRecord, specUrl?: string): string {
  let raw: string | undefined;
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
    raw = String(spec.servers[0].url);
    for (const [name, variable] of Object.entries(spec.servers[0].variables ?? {}) as [string, AnyRecord][]) {
      raw = raw.replace(`{${name}}`, String(variable.default ?? variable.enum?.[0] ?? ""));
    }
  } else if (spec.swagger === "2.0" && spec.host) {
    raw = `${spec.schemes?.[0] ?? "https"}://${spec.host}${spec.basePath ?? ""}`;
  }
  if (!raw) throw new ByokOpenApiError("The OpenAPI spec has no servers or host.", "servers");
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  if (!specUrl) throw new ByokOpenApiError("The OpenAPI server URL is relative, but the spec URL is unknown.", "servers");
  return new URL(raw, specUrl).toString().replace(/\/+$/, "");
}

function authFromSpec(spec: AnyRecord): Pick<ParsedByokOpenApi, "authType" | "authKey"> {
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const preferred = Object.values(schemes) as AnyRecord[];
  const scheme = preferred.find((s) => s.type === "http" && String(s.scheme).toLowerCase() === "bearer")
    ?? preferred.find((s) => s.type === "apiKey" && (s.in === "header" || s.in === "query"));
  if (!scheme) return {};
  if (scheme.type === "http") return { authType: "bearer" };
  return { authType: scheme.in === "query" ? "query" : "header", authKey: scheme.name };
}

function makeProbe(baseUrl: string, path: string, parameters: AnyRecord[]): string | undefined {
  let result = path;
  const query = new URLSearchParams();
  for (const parameter of parameters) {
    if (!parameter.required) continue;
    const value = exampleFor(parameter);
    if (value == null) return undefined;
    if (parameter.in === "path") result = result.replace(`{${parameter.name}}`, encodeURIComponent(value));
    else if (parameter.in === "query") query.set(parameter.name, value);
    else return undefined;
  }
  const url = new URL(result.replace(/^\/+/, ""), `${baseUrl}/`);
  for (const [key, value] of query) url.searchParams.set(key, value);
  return url.toString();
}

export function parseByokOpenApi(input: string, specUrl?: string): ParsedByokOpenApi {
  let spec: AnyRecord;
  try {
    if (!input.trim().startsWith("{")) {
      throw new ByokOpenApiError("Only JSON OpenAPI specs are supported; YAML specs cannot be parsed.", "parse");
    }
    spec = JSON.parse(input);
  } catch (error) {
    if (error instanceof ByokOpenApiError) throw error;
    throw new ByokOpenApiError("The OpenAPI spec could not be parsed as JSON.", "parse");
  }
  if (!spec.openapi?.startsWith("3.") && spec.swagger !== "2.0") {
    throw new ByokOpenApiError("The document is not an OpenAPI 3.x or Swagger 2.0 spec.", "parse");
  }
  const baseUrl = serverUrl(spec, specUrl);
  const auth = authFromSpec(spec);
  const operations: ByokOpenApiOperation[] = [];
  const candidates: Array<{ operation: ByokOpenApiOperation; preferred: boolean; safe: boolean; length: number }> = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {}) as [string, AnyRecord][]) {
    const operation = pathItem.get;
    if (!operation) continue;
    const parameters = operationParameters(spec, pathItem, operation);
    const probeUrl = makeProbe(baseUrl, path, parameters);
    const item = { method: "GET" as const, path, summary: operation.summary, tags: operation.tags, probeUrl };
    operations.push(item);
    candidates.push({ operation: item, preferred: /\/(healthz?|ping|status|me|user|account)(?:\/|$)/i.test(path), safe: Boolean(probeUrl), length: path.length });
  }
  const probe = candidates.filter((c) => c.safe).sort((a, b) =>
    Number(b.preferred) - Number(a.preferred) || a.length - b.length,
  )[0]?.operation;
  if (!probe) throw new ByokOpenApiError("The OpenAPI spec has no safely callable GET operation.", "probe");
  return { baseUrl, ...auth, operations, probe };
}
