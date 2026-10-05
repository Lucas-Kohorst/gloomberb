import { afterEach, describe, expect, test } from "bun:test";
import { apiClient } from "../../../../api-client";
import { teamSessionReady } from "./session";

afterEach(() => {
  apiClient.setSessionToken(null);
});

describe("team session", () => {
  test("a Pro account with a dropped verification flag can open teams", () => {
    apiClient.setSessionToken("pro-session");
    apiClient.restoreCachedUser({ id: "u0", username: "lucas", emailVerified: false, plan: "pro" });
    expect(apiClient.isVerified()).toBe(false);
    expect(teamSessionReady()).toBe(true);
  });

  test("a signed-out session cannot open teams", () => {
    apiClient.setSessionToken(null);
    expect(teamSessionReady()).toBe(false);
  });

  test("a free unverified session still has to verify email", () => {
    apiClient.setSessionToken("free-session");
    apiClient.restoreCachedUser({ id: "u1", username: "guest", emailVerified: false, plan: "free" });
    expect(teamSessionReady()).toBe(false);
  });
});
