import {
  ROBINHOOD_OAUTH_CHANNEL,
  ROBINHOOD_OAUTH_MESSAGE_SOURCE,
  ROBINHOOD_TOKEN_URL,
} from "../../shared/robinhood-oauth";

export const ROBINHOOD_OAUTH_CALLBACK_PATH = "/api/oauth/robinhood/callback";
export const ROBINHOOD_OAUTH_TOKEN_PATH = "/api/oauth/robinhood/token";

export function renderRobinhoodOAuthCallbackPage(requestUrl: URL): string {
  const code = requestUrl.searchParams.get("code") ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";
  const error = requestUrl.searchParams.get("error") ?? "";
  const payload = JSON.stringify({
    source: ROBINHOOD_OAUTH_MESSAGE_SOURCE,
    code: code || null,
    state: state || null,
    error: error || null,
  });
  const heading = error ? "Robinhood sign-in failed." : "Robinhood is connected.";
  const body = error
    ? "Return to Gloomberb and try again."
    : "You can close this tab and return to Gloomberb.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Robinhood</title>
</head>
<body>
  <p>${heading} ${body}</p>
  <script>
    (function () {
      var payload = ${payload};
      try {
        if (window.opener) window.opener.postMessage(payload, location.origin);
      } catch (error) {}
      try {
        var channel = new BroadcastChannel(${JSON.stringify(ROBINHOOD_OAUTH_CHANNEL)});
        channel.postMessage(payload);
        channel.close();
      } catch (error) {}
      window.close();
    })();
  </script>
</body>
</html>`;
}

export async function proxyRobinhoodTokenRequest(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const upstream = await fetchImpl(ROBINHOOD_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/x-www-form-urlencoded",
      accept: request.headers.get("accept") || "application/json",
    },
    body: await request.text(),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return new Response(await upstream.text(), { status: upstream.status, headers });
}
