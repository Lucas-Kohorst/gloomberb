import { afterEach, describe, expect, test } from "bun:test";
import { getBrowserLocation, getBrowserWindow } from "./browser-location";
import { isPublicShareLocation } from "../plugins/builtin/shared/share-link";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function browserWindow(pathname: string, search = ""): Record<string, unknown> {
  return {
    location: { pathname, search, protocol: "https:", origin: "https://terminal.kohor.st" },
    history: { replaceState: () => {} },
    dispatchEvent: () => true,
  };
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("browser detection under the OpenTUI window shim", () => {
  // `@opentui/core` runs `global.window = {}` in the terminal, so a
  // `typeof window !== "undefined"` guard passes with no DOM behind it.
  test("treats the empty terminal shim as not-a-browser", () => {
    setWindow({});
    expect(getBrowserLocation()).toBeNull();
    expect(getBrowserWindow()).toBeNull();
  });

  test("share detection returns false instead of throwing under the shim", () => {
    setWindow({});
    // Regression: this threw "Cannot destructure property 'pathname'" during
    // app bootstrap and killed the terminal app before it painted a frame.
    expect(() => isPublicShareLocation()).not.toThrow();
    expect(isPublicShareLocation()).toBe(false);
  });

  test("recognises a real browser window", () => {
    setWindow(browserWindow("/s/abc123"));
    expect(getBrowserLocation()?.pathname).toBe("/s/abc123");
    expect(getBrowserWindow()).not.toBeNull();
    expect(isPublicShareLocation()).toBe(true);
  });

  test("rejects a window missing a capability it promises", () => {
    // Callers use history.replaceState and dispatchEvent without re-checking,
    // so getBrowserWindow must not hand back a partial window.
    const noHistory = browserWindow("/s/abc123");
    delete noHistory.history;
    setWindow(noHistory);
    expect(getBrowserWindow()).toBeNull();
    // A location-only caller is still fine here.
    expect(getBrowserLocation()?.pathname).toBe("/s/abc123");

    const noDispatch = browserWindow("/s/abc123");
    delete noDispatch.dispatchEvent;
    setWindow(noDispatch);
    expect(getBrowserWindow()).toBeNull();
  });

  test("a location without a readable URL is not usable", () => {
    setWindow({ location: { pathname: "/s/abc" }, history: { replaceState: () => {} }, dispatchEvent: () => true });
    expect(getBrowserLocation()).toBeNull();
    expect(getBrowserWindow()).toBeNull();
  });

  test("accepts a location that omits protocol and origin", () => {
    // Only the TV pane reads those, so they must not gate share detection.
    setWindow({ location: { pathname: "/s/abc123", search: "" } });
    expect(getBrowserLocation()?.pathname).toBe("/s/abc123");
    expect(isPublicShareLocation()).toBe(true);
  });
});
