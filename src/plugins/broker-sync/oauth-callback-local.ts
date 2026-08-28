import { createServer, type Server } from "node:http";
import type { OAuthCallback } from "./oauth-callback";

export type { OAuthCallback } from "./oauth-callback";

export const ROBINHOOD_LOCAL_CALLBACK_PORT = 53921;

export async function startLocalOAuthCallback(expectedState: string): Promise<OAuthCallback> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    action();
  };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end("Not found.");
      return;
    }
    const state = url.searchParams.get("state");
    if (state !== expectedState) {
      // A leftover tab from an earlier attempt must not cancel the live one.
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("This Robinhood sign-in is stale. Return to Gloomberb and start a new sync.");
      return;
    }
    const error = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    if (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Robinhood sign-in failed. Return to Gloomberb.");
      finish(() => rejectCode(new Error(`Robinhood sign-in failed: ${error}.`)));
      return;
    }
    if (!authorizationCode) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Gloomberb could not verify this Robinhood sign-in.");
      finish(() => rejectCode(new Error("Gloomberb could not verify the Robinhood sign-in response.")));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Robinhood is connected. You can close this page and return to Gloomberb.");
    finish(() => resolveCode(authorizationCode));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error("A Robinhood sign-in is already in progress. Finish it in your browser or wait, then try again."));
        return;
      }
      reject(error);
    });
    server.listen(ROBINHOOD_LOCAL_CALLBACK_PORT, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Gloomberb could not start the Robinhood sign-in callback.");
  }
  const timeout = setTimeout(() => {
    finish(() => rejectCode(new Error("Robinhood sign-in timed out.")));
  }, 5 * 60_000);
  return {
    redirectUrl: `http://127.0.0.1:${address.port}/callback`,
    code,
    close: async () => {
      clearTimeout(timeout);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function openExternalAuthorizationUrl(url: URL): Promise<void> {
  const command = process.platform === "darwin"
    ? ["open", url.toString()]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url.toString()]
      : ["xdg-open", url.toString()];
  const processHandle = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) throw new Error("Gloomberb could not open the Robinhood sign-in page.");
}
