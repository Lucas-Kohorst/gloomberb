import { httpFetch } from "../utils/http-transport";
import { withDeadline } from "../utils/async-deadline";
import { ApiRequestError, parseApiErrorMessage } from "./errors";

const DEFAULT_API_URL = "https://api.gloom.sh";
const DEFAULT_MARKET_REQUEST_TIMEOUT_MS = 10_000;
const SESSION_COOKIE_NAMES = ["__Secure-gloomberb.session_token", "gloomberb.session_token"] as const;

type CloudApiResponse = Pick<Response, "ok" | "status" | "headers" | "text">;
type CloudApiFetchTransport = (url: string, init?: RequestInit) => Promise<CloudApiResponse>;
type SessionCookieName = (typeof SESSION_COOKIE_NAMES)[number];

let cloudApiFetchTransport: CloudApiFetchTransport = httpFetch;

export function setCloudApiFetchTransport(transport: CloudApiFetchTransport | null): void {
  cloudApiFetchTransport = transport ?? httpFetch;
}

export function getCloudApiBaseUrl(): string {
  if (typeof process === "undefined") {
    return DEFAULT_API_URL;
  }
  return process.env.GLOOMBERB_API_URL ?? DEFAULT_API_URL;
}

function throwIfRequestAborted(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

export class CloudApiRequestTransport {
  private sessionToken: string | null = null;
  private sessionCookieName: SessionCookieName | null = null;
  private websocketToken: string | null = null;
  private hostedSocketBaseUrl: string | null = null;
  private readonly fetchTransport: CloudApiFetchTransport | null;
  private readonly marketRequestTimeoutMs: number;

  readonly baseUrl = getCloudApiBaseUrl();

  constructor(options: {
    fetchTransport?: CloudApiFetchTransport;
    marketRequestTimeoutMs?: number;
  } = {}) {
    this.fetchTransport = options.fetchTransport ?? null;
    this.marketRequestTimeoutMs = options.marketRequestTimeoutMs ?? DEFAULT_MARKET_REQUEST_TIMEOUT_MS;
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  getWebSocketToken(): string | null {
    return this.websocketToken;
  }

  setSessionToken(token: string | null): void {
    if (this.sessionToken !== token) {
      this.sessionCookieName = null;
    }
    this.sessionToken = token;
    if (!token) {
      this.websocketToken = null;
    }
  }

  setWebSocketToken(token: string | null): void {
    this.websocketToken = token;
  }

  getSocketAuthToken(): string | null {
    return this.websocketToken || this.sessionToken;
  }

  /**
   * In the hosted web client the WebSocket must connect to the Worker's own
   * origin (which relays to Gloom Cloud with the server-held session), not
   * directly to api.gloom.sh. Setting this switches the socket to same-origin,
   * cookie-authenticated mode.
   */
  setHostedSocketBaseUrl(url: string | null): void {
    this.hostedSocketBaseUrl = url;
  }

  isHostedSocket(): boolean {
    return this.hostedSocketBaseUrl !== null;
  }

  getSocketBaseUrl(): string {
    return this.hostedSocketBaseUrl ?? this.baseUrl;
  }

  clearWebSocketTokenForFallback(): boolean {
    if (!this.websocketToken || !this.sessionToken) return false;
    this.websocketToken = null;
    return true;
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!path.startsWith("/market/")) {
      return this.performRequest<T>(path, options);
    }

    const controller = new AbortController();
    const callerSignal = options?.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const request = this.performRequest<T>(path, {
        ...options,
        signal: controller.signal,
      });
      return await withDeadline(
        request,
        this.marketRequestTimeoutMs,
        `Cloud market request timed out after ${this.marketRequestTimeoutMs}ms: ${path}`,
        (error) => controller.abort(error),
      );
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async performRequest<T>(path: string, options?: RequestInit): Promise<T> {
    throwIfRequestAborted(options?.signal);
    const headers = this.buildRequestHeaders(options);

    const res = await (this.fetchTransport ?? cloudApiFetchTransport)(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
    throwIfRequestAborted(options?.signal);
    this.extractSessionCookie(res);
    const text = await res.text();
    throwIfRequestAborted(options?.signal);

    if (!res.ok) {
      const msg = parseApiErrorMessage(text);
      throw new ApiRequestError(msg, res.status);
    }

    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as T & { token?: string };
    // The hosted client authenticates the socket through the Worker's HttpOnly
    // cookie, so it must never hold a raw upstream token — the Worker also
    // strips it from response bodies, but never capture it here as defense in
    // depth.
    if (!this.isHostedSocket() && typeof parsed?.token === "string" && parsed.token.length > 0) {
      this.websocketToken = parsed.token;
    }
    return parsed as T;
  }

  private extractSessionCookie(res: CloudApiResponse): void {
    if (res.headers.get("x-gloom-hosted-session") === "1") {
      this.sessionToken = "hosted-session";
      this.sessionCookieName = null;
      return;
    }
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const fallbackHeader = res.headers.get("set-cookie");
    if (fallbackHeader) {
      setCookie.push(fallbackHeader);
    }
    for (const cookie of setCookie) {
      for (const cookieName of SESSION_COOKIE_NAMES) {
        const escapedCookieName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = cookie.match(new RegExp(`${escapedCookieName}=([^;]+)`));
        if (!match) continue;
        this.sessionToken = match[1] ?? null;
        this.sessionCookieName = cookieName;
        return;
      }
    }
  }

  private buildSessionCookieHeader(): string | null {
    if (!this.sessionToken) return null;
    const cookieNames = this.sessionCookieName ? [this.sessionCookieName] : SESSION_COOKIE_NAMES;
    return cookieNames.map((cookieName) => `${cookieName}=${this.sessionToken}`).join("; ");
  }

  // Webview `Headers` drops Cookie/Origin as forbidden request headers. A
  // plain map is what Electrobun can RPC to bun without losing the session.
  private buildRequestHeaders(options?: RequestInit): Record<string, string> {
    const headers = copyRequestHeaders(options?.headers);
    if (!hasHeader(headers, "Content-Type") && options?.method && options.method !== "GET") {
      headers["Content-Type"] = "application/json";
    }
    const cookieHeader = this.buildSessionCookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    headers.Origin = this.baseUrl;
    return headers;
  }
}

function copyRequestHeaders(source: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!source) return headers;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      headers[key] = value;
    }
    return headers;
  }
  return { ...source };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}
