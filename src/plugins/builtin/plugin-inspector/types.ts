export const PLUGIN_INSPECTOR_PLUGIN_ID = "plugin-inspector";
export const PLUGIN_INSPECTOR_PANE_ID = "plugin-inspector";
export const PLUGIN_INSPECTOR_TEMPLATE_ID = "plugin-inspector-pane";

export type InspectorSource = "built-in" | "external";
export type InspectorStatus = "enabled" | "disabled" | "error" | "on";

export interface InspectorRow {
  id: string;
  name: string;
  version: string;
  source: InspectorSource;
  status: InspectorStatus;
  description: string;
  toggleable: boolean;
  path?: string;
  hasError?: boolean;
  error?: string;
}

export interface PluginDetailItem {
  label: string;
  value: string;
}
