import { PLUGIN_HOST_GLOBAL, SHARED_SPECIFIERS } from "./host-contract";

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

  const [
    react,
    jsxRuntime,
    jsxDevRuntime,
    typesPlugin,
    typesPersistence,
    ui,
    components,
    theme,
    capabilities,
    utils,
    pluginReact,
    pluginsHelpers,
  ] = await Promise.all([
    import("react"),
    import("react/jsx-runtime"),
    import("react/jsx-dev-runtime"),
    // Type-only modules still need an entry: a plugin may import a runtime
    // value from them, and a missing key throws a clearer error than undefined.
    import("../types/plugin"),
    import("../types/persistence"),
    import("../ui"),
    import("../components"),
    import("../theme/colors"),
    import("../capabilities"),
    import("../public/utils"),
    import("../public/react"),
    import("./helpers"),
  ]);

  const registry: Record<string, unknown> = {
    "react": react,
    "react/jsx-runtime": jsxRuntime,
    "react/jsx-dev-runtime": createPluginJsxDevRuntime(jsxRuntime, jsxDevRuntime),
    "gloomberb/types/plugin": typesPlugin,
    "gloomberb/types/persistence": typesPersistence,
    "gloomberb/ui": ui,
    "gloomberb/components": components,
    "gloomberb/theme": theme,
    "gloomberb/capabilities": capabilities,
    "gloomberb/utils": utils,
    "gloomberb/react": pluginReact,
    "gloomberb/plugins": pluginsHelpers,
  };

  for (const specifier of SHARED_SPECIFIERS) {
    if (!registry[specifier]) throw new Error(`Plugin host registry is missing "${specifier}"`);
  }

  globals[PLUGIN_HOST_GLOBAL] = registry;
}
