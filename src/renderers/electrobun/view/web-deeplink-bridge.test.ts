import { afterEach, describe, expect, test } from "bun:test";
import { createWebDeepLinkBridge } from "./web-deeplink-bridge";

const originalWindow = globalThis.window;

function setLocation(pathname: string, search = "", hash = ""): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { pathname, search, hash },
      addEventListener() {},
      removeEventListener() {},
    },
  });
}

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("createWebDeepLinkBridge", () => {
  test("maps /s/{id} to a share deep link so authed SPA boots still open the snapshot", () => {
    setLocation("/s/cqT4HwQPu8J2");
    const seen: string[] = [];
    const unsubscribe = createWebDeepLinkBridge().subscribe((deeplink) => {
      seen.push(deeplink.url);
    });
    expect(seen).toEqual(["gloomberb://share?s=cqT4HwQPu8J2"]);
    unsubscribe();
  });

  test("does not treat the terminal hand-off query as a public share path", () => {
    setLocation("/", `?gloomberb=${encodeURIComponent("gloomberb://share?s=cqT4HwQPu8J2")}`);
    const seen: string[] = [];
    createWebDeepLinkBridge().subscribe((deeplink) => {
      seen.push(deeplink.url);
    });
    expect(seen).toEqual(["gloomberb://share?s=cqT4HwQPu8J2"]);
  });
});
