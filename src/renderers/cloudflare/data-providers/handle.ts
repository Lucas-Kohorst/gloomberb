import { getKeyedDataProvider, listKeyedDataProviders } from "./registry";
import {
  KEYED_DATA_ALIAS_PATH,
  KEYED_DATA_PATH,
  KEYED_DATA_PROVIDER_ALIASES,
  TWC_KALSHI_ALIAS_PATH,
  type KeyedDataProvider,
  type ProviderPlan,
} from "./types";

const PROXY_TIMEOUT_MS = 12_000;
const PROXY_ORIGIN_RETRIES = 2;
const CLOUDFLARE_ORIGIN_TIMEOUT_STATUSES = new Set([522, 524, 530]);
const ADJACENT_ORIGIN_HOST = "api.adjacent.markets";
const ADJACENT_PUBLIC_PREFIXES = new Set(["markets", "indices", "rates", "events"]);
const MAX_PRINT_CACHE = 256;

interface MemoryCacheEntry {
  expiresAt: number;
  status: number;
  contentType: string;
  body: string;
}

const printCache = new Map<string, MemoryCacheEntry>();

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (host === "::1" || host === "::") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function attachSecret(headers: Headers, provider: KeyedDataProvider, env: Env): void {
  if (!provider.secret) return;
  const secret = (env as unknown as Record<string, string | undefined>)[provider.secret.envKey];
  if (!secret) return;
  const value = provider.secret.headerValue?.(secret) ?? secret;
  headers.set(provider.secret.headerName, value);
}

function cacheControlFor(ttlSeconds: number): string {
  return `public, max-age=${ttlSeconds}`;
}

/** Auth Adjacent URLs 522 when Cloudflare cannot reach Adjacent origin; public is cached. */
export function adjacentPublicFallbackUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== ADJACENT_ORIGIN_HOST) return null;
  if (!parsed.pathname.startsWith("/api/v1/")) return null;
  const rest = parsed.pathname.slice("/api/v1/".length);
  if (!rest || rest.startsWith("public/")) return null;
  const head = rest.split("/")[0] ?? "";
  if (!ADJACENT_PUBLIC_PREFIXES.has(head)) return null;
  parsed.pathname = `/api/v1/public/${rest}`;
  return parsed.toString();
}

function isOriginTimeoutStatus(status: number): boolean {
  return CLOUDFLARE_ORIGIN_TIMEOUT_STATUSES.has(status);
}

function cachedResponse(entry: MemoryCacheEntry): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      "content-type": entry.contentType,
      "cache-control": cacheControlFor(Math.max(1, Math.floor((entry.expiresAt - Date.now()) / 1000))),
    },
  });
}

function remember(
  key: string,
  ttlSeconds: number,
  status: number,
  contentType: string,
  body: string,
): void {
  if (printCache.size >= MAX_PRINT_CACHE) {
    const first = printCache.keys().next().value;
    if (first) printCache.delete(first);
  }
  printCache.set(key, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    status,
    contentType,
    body,
  });
}

function parseDataPath(url: URL): { providerId: string; keyPath: string } | null {
  if (url.pathname.startsWith(TWC_KALSHI_ALIAS_PATH)) {
    const suffix = url.pathname.slice(TWC_KALSHI_ALIAS_PATH.length);
    return {
      providerId: "twc-kalshi",
      keyPath: suffix.replace(/^\//, ""),
    };
  }
  if (url.pathname === KEYED_DATA_PATH || url.pathname === `${KEYED_DATA_PATH}/`) {
    return { providerId: "", keyPath: "" };
  }
  const base = url.pathname.startsWith(`${KEYED_DATA_ALIAS_PATH}/`)
    ? KEYED_DATA_ALIAS_PATH
    : url.pathname.startsWith(`${KEYED_DATA_PATH}/`)
      ? KEYED_DATA_PATH
      : null;
  if (!base) return null;
  const rest = url.pathname.slice(`${base}/`.length);
  const slash = rest.indexOf("/");
  const rawId = slash < 0 ? rest : rest.slice(0, slash);
  return {
    // Own-property only: a bare lookup resolves "constructor" off the
    // prototype chain and hands a function to the registry.
    providerId: Object.hasOwn(KEYED_DATA_PROVIDER_ALIASES, rawId)
      ? KEYED_DATA_PROVIDER_ALIASES[rawId]!
      : rawId,
    keyPath: slash < 0 ? "" : rest.slice(slash + 1),
  };
}

async function executeProxy(
  provider: KeyedDataProvider,
  plan: Extract<ProviderPlan, { kind: "proxy" }>,
  env: Env,
): Promise<Response> {
  let target: URL;
  try {
    target = new URL(plan.url);
  } catch {
    return jsonError("Invalid upstream URL", 400);
  }
  if (target.protocol !== "https:") return jsonError("Unsupported protocol", 400);
  if (isPrivateHostname(target.hostname)) return jsonError("Blocked target", 403);

  const urls = [target.toString()];
  const publicFallback = adjacentPublicFallbackUrl(target.toString());
  if (publicFallback) urls.push(publicFallback);

  let lastStatus = 502;
  for (const [urlIndex, url] of urls.entries()) {
    const useSecret = urlIndex === 0;
    for (let attempt = 0; attempt < PROXY_ORIGIN_RETRIES; attempt += 1) {
      const headers = new Headers({
        Accept: "application/json",
        "User-Agent": provider.userAgent,
        ...plan.extraHeaders,
      });
      if (useSecret) attachSecret(headers, provider, env);
      try {
        const upstream = await fetch(url, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        });
        const retryOtherOrigin =
          isOriginTimeoutStatus(upstream.status)
          || upstream.status >= 500
          || (upstream.status === 401 && urlIndex === 0 && urls.length > 1);
        if (upstream.ok || !retryOtherOrigin) {
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "content-type": upstream.headers.get("content-type") ?? "application/json",
              "cache-control": cacheControlFor(provider.ttlSeconds),
            },
          });
        }
        lastStatus = upstream.status;
      } catch {
        lastStatus = 502;
      }
    }
  }
  return jsonError("Upstream origin timeout", isOriginTimeoutStatus(lastStatus) ? 502 : lastStatus);
}

async function executePrint(
  provider: KeyedDataProvider,
  plan: Extract<ProviderPlan, { kind: "print" }>,
): Promise<Response> {
  const cached = printCache.get(plan.cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cachedResponse(cached);
  try {
    const value = await plan.load(fetch);
    const body = JSON.stringify(value);
    remember(plan.cacheKey, provider.ttlSeconds, 200, "application/json", body);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": cacheControlFor(provider.ttlSeconds),
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    const message = error instanceof Error ? error.message : "Upstream print failed.";
    return jsonError(message, status);
  }
}

export async function handleKeyedDataRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError("Method not allowed", 405);
  }

  const parsed = parseDataPath(url);
  if (!parsed) return jsonError("Not found", 404);

  if (!parsed.providerId) {
    return Response.json(
      { providers: listKeyedDataProviders() },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  }

  const provider = getKeyedDataProvider(parsed.providerId);
  if (!provider) return jsonError("Unknown data provider", 404);

  const plan = await provider.resolve({
    keyPath: parsed.keyPath,
    search: url.searchParams,
    env,
  });
  if (plan.kind === "error") return jsonError(plan.error, plan.status);
  if (plan.kind === "proxy") return executeProxy(provider, plan, env);
  return executePrint(provider, plan);
}

export function resetKeyedDataCache(): void {
  printCache.clear();
}
