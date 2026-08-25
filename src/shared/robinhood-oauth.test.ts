import { describe, expect, test } from "bun:test";
import { startAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import { SHARE_HOSTED_ORIGIN } from "../shares/routes";
import {
  ROBINHOOD_AGENT_GATEWAY_CLIENT_ID,
  ROBINHOOD_HOSTED_ORIGIN,
  ROBINHOOD_MCP_URL,
  ROBINHOOD_OAUTH_SCOPE,
  ROBINHOOD_TOKEN_URL,
  isRobinhoodOAuthMessageOrigin,
  robinhoodBrowserRedirectUrl,
  robinhoodClientMetadata,
  robinhoodHostedRedirectUrl,
} from "./robinhood-oauth";

const ROBINHOOD_AUTH_METADATA = {
  authorization_endpoint: "https://robinhood.com/oauth",
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  issuer: ROBINHOOD_MCP_URL,
  registration_endpoint: "https://agent.robinhood.com/oauth/trading/register",
  response_types_supported: ["code"],
  scopes_supported: [ROBINHOOD_OAUTH_SCOPE],
  token_endpoint: ROBINHOOD_TOKEN_URL,
  token_endpoint_auth_methods_supported: ["none"],
};

describe("hosted Robinhood authorize request", () => {
  test("always sends the public https callback, never http, www, or a trailing slash", () => {
    expect(ROBINHOOD_HOSTED_ORIGIN).toBe(SHARE_HOSTED_ORIGIN);
    expect(robinhoodHostedRedirectUrl()).toBe("https://terminal.kohor.st/api/oauth/robinhood/callback");
    expect(robinhoodBrowserRedirectUrl("https://terminal.kohor.st")).toBe(robinhoodHostedRedirectUrl());
    expect(robinhoodBrowserRedirectUrl("https://terminal.kohor.st/")).toBe(robinhoodHostedRedirectUrl());
    expect(robinhoodBrowserRedirectUrl("https://gloomberb-cloud.kohorstlucas.workers.dev")).toBe(
      robinhoodHostedRedirectUrl(),
    );
    const hosted = new URL(robinhoodHostedRedirectUrl());
    expect(hosted.protocol).toBe("https:");
    expect(hosted.hostname).toBe("terminal.kohor.st");
    expect(hosted.pathname).toBe("/api/oauth/robinhood/callback");
    expect(hosted.search).toBe("");
    expect(hosted.hash).toBe("");
    expect(hosted.href.endsWith("/")).toBe(false);
    expect(hosted.hostname.startsWith("www.")).toBe(false);
  });

  test("keeps loopback origins local so desktop/web dev can still listen", () => {
    expect(robinhoodBrowserRedirectUrl("http://127.0.0.1:4173")).toBe(
      "http://127.0.0.1:4173/api/oauth/robinhood/callback",
    );
    expect(robinhoodBrowserRedirectUrl("http://localhost:4173")).toBe(
      "http://localhost:4173/api/oauth/robinhood/callback",
    );
  });

  test("registers a public PKCE client with the Agent Gateway scope and no secret", () => {
    const metadata = robinhoodClientMetadata(robinhoodHostedRedirectUrl());
    expect(metadata.token_endpoint_auth_method).toBe("none");
    expect(metadata.scope).toBe("internal");
    expect(metadata.redirect_uris).toEqual([robinhoodHostedRedirectUrl()]);
    expect(metadata).not.toHaveProperty("client_secret");
    expect(metadata.grant_types).toContain("authorization_code");
    expect(metadata.response_types).toEqual(["code"]);
  });

  test("authorize URL uses robinhood.com/oauth, S256, exact redirect, and no client secret", async () => {
    const { authorizationUrl } = await startAuthorization(ROBINHOOD_MCP_URL, {
      metadata: ROBINHOOD_AUTH_METADATA,
      clientInformation: { client_id: ROBINHOOD_AGENT_GATEWAY_CLIENT_ID },
      redirectUrl: robinhoodHostedRedirectUrl(),
      scope: ROBINHOOD_OAUTH_SCOPE,
      state: "state-1",
      resource: new URL(ROBINHOOD_MCP_URL),
    });
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe("https://robinhood.com/oauth");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(ROBINHOOD_AGENT_GATEWAY_CLIENT_ID);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(robinhoodHostedRedirectUrl());
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("scope")).toBe("internal");
    expect(authorizationUrl.searchParams.get("resource")).toBe(ROBINHOOD_MCP_URL);
    expect(authorizationUrl.searchParams.get("state")).toBe("state-1");
    expect(authorizationUrl.searchParams.has("client_secret")).toBe(false);
  });

  test("accepts OAuth postMessage from the canonical hosted origin when the tab is on an alias", () => {
    expect(isRobinhoodOAuthMessageOrigin(ROBINHOOD_HOSTED_ORIGIN, ROBINHOOD_HOSTED_ORIGIN)).toBe(true);
    expect(isRobinhoodOAuthMessageOrigin(
      ROBINHOOD_HOSTED_ORIGIN,
      "https://gloomberb-cloud.kohorstlucas.workers.dev",
    )).toBe(true);
    expect(isRobinhoodOAuthMessageOrigin("https://evil.example", ROBINHOOD_HOSTED_ORIGIN)).toBe(false);
  });
});
