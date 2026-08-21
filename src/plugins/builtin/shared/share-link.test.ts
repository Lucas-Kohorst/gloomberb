import { afterEach, describe, expect, test } from "bun:test";
import { isPublicShareLocation, isShareTerminalHandoff } from "./share-link";

// URL shapes themselves are covered in src/shares/routes.test.ts. What this
// module adds is the onboarding bypass, which reads a browser location.
const originalWindow = globalThis.window;

function setLocation(pathname: string, search = ""): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { pathname, search } },
  });
}

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("isPublicShareLocation", () => {
  test("bypasses onboarding for a stored share path", () => {
    setLocation("/s/abcdef1234567890");
    expect(isPublicShareLocation()).toBe(true);
  });

  test("still treats /s/{id} as public when the visitor already has a session query", () => {
    setLocation("/s/cqT4HwQPu8J2", "?utm=signed-in");
    expect(isPublicShareLocation()).toBe(true);
    expect(isShareTerminalHandoff()).toBe(false);
  });

  test("does not bypass onboarding for the share page's open-in-terminal hand-off", () => {
    setLocation("/", "?gloomberb=gloomberb%3A%2F%2Fshare%3Fs%3Dabcdef1234567890");
    expect(isPublicShareLocation()).toBe(false);
    expect(isShareTerminalHandoff()).toBe(true);

    setLocation("/", "?gloomberb=gloomberb%3A%2F%2Farticle%3Fa%3DeyJhIjoxfQ");
    expect(isPublicShareLocation()).toBe(false);
    expect(isShareTerminalHandoff()).toBe(true);
  });

  test("does not bypass onboarding for unrelated deep links", () => {
    setLocation("/", "?gloomberb=gloomberb%3A%2F%2Fsettings");
    expect(isPublicShareLocation()).toBe(false);
    expect(isShareTerminalHandoff()).toBe(false);
  });

  test("requires an article payload that actually decodes", () => {
    setLocation("/article", "?a=not-a-payload");
    expect(isPublicShareLocation()).toBe(false);
  });

  test("does not bypass onboarding for ordinary app paths", () => {
    setLocation("/s/");
    expect(isPublicShareLocation()).toBe(false);
    setLocation("/dashboard");
    expect(isPublicShareLocation()).toBe(false);
  });

  test("returns false outside a browser", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(isPublicShareLocation()).toBe(false);
  });
});
