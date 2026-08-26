import * as React from "react";
import * as ui from "../../ui";
import * as components from "../../components";
import { colors } from "../../theme/colors";
import * as pluginRuntime from "../runtime";
import * as reactInput from "../../react/input";

declare global {
  // eslint-disable-next-line no-var
  var __GLOOM_PLUGIN_RUNTIME: Record<string, unknown> | undefined;
}

export function installGloomPluginRuntime(): void {
  globalThis.__GLOOM_PLUGIN_RUNTIME = {
    react: React,
    "gloomberb/ui": ui,
    "gloomberb/components": components,
    "gloomberb/theme/colors": { colors },
    "gloomberb/plugins/runtime": pluginRuntime,
    "gloomberb/react/input": reactInput,
  };
}
