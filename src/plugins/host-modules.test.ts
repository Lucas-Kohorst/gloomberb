import { describe, expect, test } from "bun:test";

import { PLUGIN_HOST_GLOBAL } from "./host-contract";
import { createPluginJsxDevRuntime, installPluginHostModules } from "./host-modules";

describe("createPluginJsxDevRuntime", () => {
  test("falls back to production jsx when React leaves jsxDEV undefined", () => {
    const jsx = () => null;
    const runtime = createPluginJsxDevRuntime({ jsx }, { jsxDEV: undefined });

    expect(runtime.jsxDEV).toBe(jsx);
  });
});

describe("installPluginHostModules", () => {
  test("publishes the development JSX runtime for external TSX plugins", async () => {
    await installPluginHostModules();

    const registry = (globalThis as Record<string, Record<string, unknown>>)[PLUGIN_HOST_GLOBAL]!;
    const jsxDevRuntime = registry["react/jsx-dev-runtime"] as { jsxDEV?: unknown };

    expect(typeof jsxDevRuntime.jsxDEV).toBe("function");
  });
});
