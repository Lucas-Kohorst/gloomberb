import { createElement, type ReactNode } from "react";
import { Text } from "../../ui";
import type { PaneDef, PluginPaneRegistration } from "../../types/plugin";

export type LoosePaneDef = PluginPaneRegistration;

function fallbackView(name: string): ReactNode {
  return createElement(Text, null, `Pane "${name}" has no view.`);
}

function coercePaneOutput(output: unknown, name: string): ReactNode {
  if (output == null) return fallbackView(name);
  if (typeof output === "string" || typeof output === "number") return createElement(Text, null, String(output));
  return output as ReactNode;
}

export function resolvePaneComponent(pane: LoosePaneDef, name: string): PaneDef["component"] {
  if (typeof pane.component === "function") return pane.component;
  if (typeof pane.render === "function") {
    const render = pane.render;
    return (props) => coercePaneOutput(render(props), name);
  }
  return () => fallbackView(name);
}

export function normalizeRegisteredPane(pane: LoosePaneDef): PaneDef {
  const name = (pane.name ?? pane.title ?? pane.id).trim() || pane.id;
  return {
    id: pane.id,
    name,
    icon: pane.icon,
    component: resolvePaneComponent(pane, name),
    defaultPosition: pane.defaultPosition ?? "right",
    defaultWidth: pane.defaultWidth,
    defaultFloatingSize: pane.defaultFloatingSize,
    defaultMode: pane.defaultMode,
    settings: pane.settings,
    quickSettings: pane.quickSettings,
  };
}
