/** Robinhood Trading MCP — public OAuth client, no app secret. */
export const ROBINHOOD_MCP_URL = "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_TOKEN_URL = "https://api.robinhood.com/oauth2/token/";
export const ROBINHOOD_OAUTH_SCOPE = "internal";
export const ROBINHOOD_HOSTED_CALLBACK_PATH = "/api/oauth/robinhood/callback";
export const ROBINHOOD_HOSTED_TOKEN_PATH = "/api/oauth/robinhood/token";
export const ROBINHOOD_OAUTH_MESSAGE_SOURCE = "gloomberb-robinhood-oauth";
export const ROBINHOOD_OAUTH_CHANNEL = "gloomberb-robinhood-oauth";

export const ROBINHOOD_CONNECTION_MODE = "oauth";

export const ROBINHOOD_CONNECTION_OPTION = {
  label: "Robinhood sign-in (read accounts, trade Agentic)",
  value: ROBINHOOD_CONNECTION_MODE,
  description: "Reads every Robinhood account. Orders go only to the Agentic account.",
} as const;

export function robinhoodClientMetadata(redirectUrl: string) {
  return {
    client_name: "Gloomberb",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none" as const,
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
