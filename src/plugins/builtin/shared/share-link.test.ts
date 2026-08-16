import { describe, expect, test } from "bun:test";
import {
  buildShortShareUrl,
  isPublicShareLocation,
  parseShortShareId,
} from "./share-link";

describe("share-link", () => {
  test("parseShortShareId extracts IDs from /s/{id} paths", () => {
    expect(parseShortShareId("/s/abc123")).toBe("abc123");
    expect(parseShortShareId("/s/AbC123_xyz")).toBe("AbC123_xyz");
    expect(parseShortShareId("/s/a")).toBe("a");
    expect(parseShortShareId("/article")).toBeNull();
    expect(parseShortShareId("/s/")).toBeNull();
    expect(parseShortShareId("/s/abc/def")).toBeNull();
    expect(parseShortShareId("/share/abc")).toBeNull();
  });

  test("buildShortShareUrl produces compact URLs", () => {
    expect(buildShortShareUrl("abc123")).toBe("https://terminal.kohor.st/s/abc123");
  });

  test("isPublicShareLocation recognizes short-ID paths", () => {
    const originalWindow = globalThis.window;
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { location: { pathname: "/s/abc123", search: "" } },
      });
      expect(isPublicShareLocation()).toBe(true);

      window.location.pathname = "/s/";
      expect(isPublicShareLocation()).toBe(false);

      window.location.pathname = "/dashboard";
      expect(isPublicShareLocation()).toBe(false);
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });

  test("isPublicShareLocation returns false outside browser contexts", () => {
    const originalWindow = globalThis.window;
    try {
      delete (globalThis as { window?: unknown }).window;
      expect(isPublicShareLocation()).toBe(false);
    } finally {
      if (originalWindow !== undefined) Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });

});
