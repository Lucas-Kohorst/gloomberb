import { PLUGIN_HOST_GLOBAL, SHARED_SPECIFIERS } from "./host-contract";
import { importAllPluginHostModules } from "./host-module-imports";

export function createPluginJsxDevRuntime(
  jsxRuntime: Record<string, unknown>,
  jsxDevRuntime: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof jsxDevRuntime.jsxDEV === "function") return jsxDevRuntime;
  if (typeof jsxRuntime.jsx !== "function") {
    throw new Error("React JSX runtime is missing both jsxDEV and jsx.");
  }
  // React's production jsx-dev-runtime intentionally exports jsxDEV as
  // undefined. Bun can still emit jsxDEV for workspace TSX, and the extra
  // development-only call arguments are harmless when forwarded to jsx.
  return { ...jsxDevRuntime, jsxDEV: jsxRuntime.jsx };
}

/**
 * Publishes the host's shared modules for compiled plugin bundles to read.
 *
 * Browser-context renderers load plugins as separate ES modules, so the bundler
 * rewrites their `react` and `gloomberb/*` imports to read from this registry
 * (see `bundle.ts`). This must run before any plugin bundle is imported, and
 * the modules here must be the same instances the app itself uses — importing
 * them normally is what guarantees that.
 */
export async function installPluginHostModules(): Promise<void> {
  const globals = globalThis as Record<string, unknown>;
  if (globals[PLUGIN_HOST_GLOBAL]) return;

  const modules = await importAllPluginHostModules();
  const registry: Record<string, unknown> = { ...modules };
  registry["react/jsx-dev-runtime"] = createPluginJsxDevRuntime(
    modules["react/jsx-runtime"] as Record<string, unknown>,
    modules["react/jsx-dev-runtime"] as Record<string, unknown>,
  );

  for (const specifier of SHARED_SPECIFIERS) {
    if (!registry[specifier]) throw new Error(`Plugin host registry is missing "${specifier}"`);
  }

  globals[PLUGIN_HOST_GLOBAL] = registry;
}
