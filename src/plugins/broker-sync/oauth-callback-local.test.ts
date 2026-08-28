import { describe, expect, test } from "bun:test";
import {
  ROBINHOOD_LOCAL_CALLBACK_PORT,
  startLocalOAuthCallback,
} from "./oauth-callback-local";

describe("Robinhood local OAuth callback", () => {
  test("uses a stable callback address across sign-in attempts", async () => {
    const first = await startLocalOAuthCallback("first");
    await first.close();
    const second = await startLocalOAuthCallback("second");

    try {
      expect(first.redirectUrl).toBe(`http://127.0.0.1:${ROBINHOOD_LOCAL_CALLBACK_PORT}/callback`);
      expect(second.redirectUrl).toBe(first.redirectUrl);
    } finally {
      await second.close();
    }
  });

  test("ignores a callback from a stale sign-in", async () => {
    const callback = await startLocalOAuthCallback("current");
    try {
      const stale = await fetch(`${callback.redirectUrl}?code=stale-code&state=old`);
      expect(stale.status).toBe(400);
      const valid = await fetch(`${callback.redirectUrl}?code=current-code&state=current`);
      expect(valid.status).toBe(200);
      await expect(callback.code).resolves.toBe("current-code");
    } finally {
      await callback.close();
    }
  });
});
