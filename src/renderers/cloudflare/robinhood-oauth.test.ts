import { describe, expect, test } from "bun:test";
import {
  ROBINHOOD_OAUTH_MESSAGE_SOURCE,
  isRobinhoodTokenEndpoint,
  robinhoodClientMetadata,
} from "../../shared/robinhood-oauth";
import { shouldWrapBrokerAdaptersForRemoteHost } from "../../brokers/remote-broker-adapter";
import {
  proxyRobinhoodTokenRequest,
  renderRobinhoodOAuthCallbackPage,
} from "./robinhood-oauth";

describe("hosted Robinhood OAuth", () => {
  test("callback page posts the authorization code back to Gloomberb", () => {
    const html = renderRobinhoodOAuthCallbackPage(
      new URL("https://terminal.example/api/oauth/robinhood/callback?code=abc&state=xyz"),
    );
    expect(html).toContain(ROBINHOOD_OAUTH_MESSAGE_SOURCE);
    expect(html).toContain("abc");
    expect(html).toContain("xyz");
    expect(html).toContain("postMessage");
    expect(html).toContain('postMessage(payload, "*")');
    expect(html).toContain("BroadcastChannel");
  });

  test("callback page escapes script-breaking characters in the payload", () => {
    const html = renderRobinhoodOAuthCallbackPage(
      new URL(
        "https://terminal.example/api/oauth/robinhood/callback?code=</script><script>alert(1)</script>",
      ),
    );
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("\\u003c");
  });

  test("token proxy only forwards the Robinhood token endpoint", async () => {
    expect(isRobinhoodTokenEndpoint("https://api.robinhood.com/oauth2/token/")).toBe(true);
    expect(isRobinhoodTokenEndpoint("https://evil.example/oauth2/token/")).toBe(false);
    const seen: string[] = [];
    const response = await proxyRobinhoodTokenRequest(
      new Request("https://terminal.example/api/oauth/robinhood/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=abc",
      }),
      (async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }) as typeof fetch,
    );
    expect(seen).toEqual(["https://api.robinhood.com/oauth2/token/"]);
    expect(response.status).toBe(400);
    expect(robinhoodClientMetadata("https://terminal.example/cb").token_endpoint_auth_method).toBe("none");
  });

  test("token proxy returns a 502 JSON error when the upstream fetch fails", async () => {
    const response = await proxyRobinhoodTokenRequest(
      new Request("https://terminal.example/api/oauth/robinhood/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=abc",
      }),
      (async () => {
        throw new Error("network error");
      }) as typeof fetch,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Robinhood token service is unavailable. Try again." });
  });

  test("hosted does not remote broker validate through the disabled capability host", () => {
    expect(shouldWrapBrokerAdaptersForRemoteHost(true)).toBe(false);
    expect(shouldWrapBrokerAdaptersForRemoteHost(false)).toBe(true);
  });
});
