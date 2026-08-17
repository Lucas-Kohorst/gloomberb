import { describe, expect, test } from "bun:test";
import type { ElectrobunBackendInit } from "../shared/protocol";
import {
  createHostedFallbackInit,
  resolveHostedInit,
  resolveHostedSession,
} from "./hosted-boot";

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("resolveHostedSession", () => {
  test("returns the signed-in user", async () => {
    const result = await resolveHostedSession(async () => ({
      json: async () => ({ user: { id: "user-1", emailVerified: true } }),
    }));
    expect(result.user?.id).toBe("user-1");
    expect(result.degraded).toBe(false);
  });

  test("treats an absent user as a clean sign-out, not a degraded session", async () => {
    const result = await resolveHostedSession(async () => ({
      json: async () => ({ user: null }),
    }));
    expect(result.user).toBeNull();
    expect(result.degraded).toBe(false);
  });

  test("propagates the worker's degraded flag", async () => {
    const result = await resolveHostedSession(async () => ({
      json: async () => ({ user: null, degraded: true }),
    }));
    expect(result.degraded).toBe(true);
  });

  // The regression this guards: a hanging session check left the hosted client
  // stuck on its loading placeholder forever.
  test("gives up on a hanging request instead of blocking boot", async () => {
    const started = Date.now();
    const result = await resolveHostedSession(() => never(), 20);
    expect(result.user).toBeNull();
    expect(result.degraded).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("aborts the request when the budget expires", async () => {
    let aborted = false;
    await resolveHostedSession((_url, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return never();
    }, 20);
    expect(aborted).toBe(true);
  });

  test("degrades on a transport error", async () => {
    const result = await resolveHostedSession(async () => {
      throw new Error("network down");
    });
    expect(result.degraded).toBe(true);
  });

  test("degrades when the body is not valid session json", async () => {
    const result = await resolveHostedSession(async () => ({
      json: async () => {
        throw new Error("invalid json");
      },
    }));
    expect(result.degraded).toBe(true);
  });
});

describe("resolveHostedInit", () => {
  const snapshot = createHostedFallbackInit({ userId: "user-1", windowKind: "main" });

  test("passes the backend snapshot through", async () => {
    const result = await resolveHostedInit(async () => snapshot, () => {
      throw new Error("fallback should not be used");
    });
    expect(result.init).toBe(snapshot);
    expect(result.degraded).toBe(false);
  });

  test("falls back when the backend never answers", async () => {
    const started = Date.now();
    const result = await resolveHostedInit(
      () => never<ElectrobunBackendInit>(),
      () => snapshot,
      20,
    );
    expect(result.init).toBe(snapshot);
    expect(result.degraded).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("falls back when the backend rejects", async () => {
    const result = await resolveHostedInit(async () => {
      throw new Error("rpc failed");
    }, () => snapshot);
    expect(result.degraded).toBe(true);
    expect(result.init).toBe(snapshot);
  });
});

describe("createHostedFallbackInit", () => {
  test("skips onboarding for a known user so a degraded boot is not a fresh install", () => {
    const init = createHostedFallbackInit({ userId: "user-1", windowKind: "main" });
    expect(init.config.onboardingComplete).toBe(true);
    expect(init.config.dataDir).toBe("cloud://users/user-1");
    expect(init.desktopPlatform).toBe("cloud");
  });

  test("keeps onboarding for an anonymous boot", () => {
    const init = createHostedFallbackInit({ userId: null, windowKind: "detached", paneId: "p1" });
    expect(init.config.onboardingComplete).toBeFalsy();
    expect(init.config.dataDir).toBe("cloud://users/anonymous");
    expect(init.windowKind).toBe("detached");
    expect(init.paneId).toBe("p1");
  });
});
