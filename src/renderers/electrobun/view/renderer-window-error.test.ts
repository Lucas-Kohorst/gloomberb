import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
  isBenignRendererWindowError,
  resolveRendererWindowError,
} from "./renderer-window-error";

describe("renderer window errors", () => {
  test("treats Chromium ResizeObserver loop notices as benign", () => {
    expect(isBenignRendererWindowError(
      "ResizeObserver loop completed with undelivered notifications.",
    )).toBe(true);
    expect(isBenignRendererWindowError(
      new Error("ResizeObserver loop limit exceeded"),
    )).toBe(true);
    expect(isBenignRendererWindowError("TypeError: Cannot read properties of undefined")).toBe(false);
  });

  test("does not take over the desktop after a ResizeObserver loop", () => {
    expect(resolveRendererWindowError({
      error: "ResizeObserver loop completed with undelivered notifications.",
      details: "views://mainview/index.html",
      source: "error",
      appMounted: true,
    })).toBe("ignore");
  });

  test("still crashes on a real window error after boot", () => {
    expect(resolveRendererWindowError({
      error: new Error("Cannot read properties of undefined (reading 'type')"),
      details: "views://mainview/index.html:1:1",
      source: "error",
      appMounted: true,
    })).toBe("fatal");
  });

  test("keeps the HTML bootstrap from treating ResizeObserver loops as fatal", () => {
    const bootstrap = readFileSync(
      join(import.meta.dir, "../../../../scripts/build-electrobun-view.ts"),
      "utf8",
    );
    expect(bootstrap).toContain("window.addEventListener(\"error\"");
    expect(bootstrap).toContain("/resizeobserver loop/i");
  });

  test("ignores late unhandled rejections once the app is mounted", () => {
    expect(resolveRendererWindowError({
      error: new Error("backend timeout"),
      source: "unhandledrejection",
      appMounted: true,
    })).toBe("ignore");
    expect(resolveRendererWindowError({
      error: new Error("backend timeout"),
      source: "unhandledrejection",
      appMounted: false,
    })).toBe("fatal");
  });
});
