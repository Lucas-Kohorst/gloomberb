import { describe, expect, test } from "bun:test";
import {
  buildShortShareUrl,
  decodeShareEnvelope,
  encodeShareEnvelope,
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

  test("encodeShareEnvelope / decodeShareEnvelope round-trip for chart shares", () => {
    const spec = {
      version: 1 as const,
      viewport: { range: "1M" as const, resolution: "1d" as const },
      panels: [{ id: "main" }],
      series: [{
        id: "s1",
        source: { kind: "security" as const, instrument: { symbol: "AAPL", exchange: "" }, fieldId: "market.ohlcv" },
        style: "candles" as const,
        transform: "raw" as const,
        axis: "auto" as const,
        panelId: "main",
        interpolation: "none" as const,
      }],
      studies: [],
    };
    const encoded = encodeShareEnvelope({ kind: "chart", data: { spec } });
    const decoded = decodeShareEnvelope(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.kind).toBe("chart");
    expect((decoded!.data as { spec: { series: unknown[] } }).spec.series).toHaveLength(1);
  });

  test("decodeShareEnvelope rejects invalid payloads", () => {
    expect(decodeShareEnvelope("")).toBeNull();
    expect(decodeShareEnvelope("!!!not-base64!!!")).toBeNull();
    const badJson = btoa("not json");
    expect(decodeShareEnvelope(badJson)).toBeNull();
    const wrongKind = btoa(JSON.stringify({ kind: "blog", data: {} }));
    expect(decodeShareEnvelope(wrongKind)).toBeNull();
  });
});
