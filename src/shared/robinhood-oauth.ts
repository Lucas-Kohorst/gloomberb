/** Robinhood Trading MCP — public OAuth client, no app secret. */
export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_TOKEN_URL = "https://api.robinhood.com/oauth2/token/";
export const ROBINHOOD_OAUTH_SCOPE = "internal";
export const ROBINHOOD_HOSTED_ORIGIN = "https://terminal.kohor.st";
export const ROBINHOOD_HOSTED_CALLBACK_PATH = "/api/oauth/robinhood/callback";
export const ROBINHOOD_HOSTED_TOKEN_PATH = "/api/oauth/robinhood/token";
export const ROBINHOOD_OAUTH_MESSAGE_SOURCE = "gloomberb-robinhood-oauth";
export const ROBINHOOD_OAUTH_CHANNEL = "gloomberb-robinhood-oauth";

/**
 * Shared Agent Gateway client_id returned by Robinhood DCR for every redirect.
 * Authorize still requires an exact redirect_uri allowlist match for this id.
 */
export const ROBINHOOD_AGENT_GATEWAY_CLIENT_ID = "LtLiNmbs9owbYfWgBlC68Z2VujIPuvGoAiSYr8xW";

export const ROBINHOOD_CONNECTION_MODE = "oauth";

export const ROBINHOOD_CONNECTION_OPTION = {
  label: "Robinhood sign-in (read accounts, trade Agentic)",
  value: ROBINHOOD_CONNECTION_MODE,
  description: "Reads every Robinhood account. Orders go only to the Agentic account.",
} as const;

const WORKERS_DEV_ORIGIN_RE = /^https:\/\/gloomberb-cloud\.[a-z0-9-]+\.workers\.dev$/;

function isLoopbackHttpOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

/** Exact hosted callback Robinhood must allowlist. No trailing slash, always https. */
export function robinhoodHostedRedirectUrl(): string {
  return `${ROBINHOOD_HOSTED_ORIGIN}${ROBINHOOD_HOSTED_CALLBACK_PATH}`;
}

/**
 * Redirect URI registered with Robinhood and sent on the authorize request.
 * Hosted aliases (workers.dev) still use the public terminal origin so the URI
 * is stable. Loopback http origins stay local for desktop/web dev.
 */
export function robinhoodBrowserRedirectUrl(pageOrigin: string): string {
  if (isLoopbackHttpOrigin(pageOrigin)) {
    return `${new URL(pageOrigin).origin}${ROBINHOOD_HOSTED_CALLBACK_PATH}`;
  }
  return robinhoodHostedRedirectUrl();
}

export function isRobinhoodOAuthMessageOrigin(messageOrigin: string, pageOrigin: string): boolean {
  if (messageOrigin === pageOrigin) return true;
  if (messageOrigin === ROBINHOOD_HOSTED_ORIGIN) return true;
  return WORKERS_DEV_ORIGIN_RE.test(messageOrigin);
}

export function robinhoodClientMetadata(redirectUrl: string) {
  return {
    client_name: "Gloomberb",
    client_uri: ROBINHOOD_HOSTED_ORIGIN,
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none" as const,
    scope: ROBINHOOD_OAUTH_SCOPE,
  };
}

export function isRobinhoodTokenEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://api.robinhood.com"
      && parsed.pathname.replace(/\/+$/, "") === "/oauth2/token";
  } catch {
    return false;
  }
}
