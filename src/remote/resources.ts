import type { Dispatch } from "react";
import type { PluginRegistry } from "../plugins/registry";
import type { AppAction, AppState } from "../state/app/context";
import type { PaneRuntimeState } from "../core/state/app/state";
import { setPaneSettings } from "../pane-settings";
import { listConnectionSources } from "../plugins/builtin/connections/register";
import type { LayoutConfig } from "../types/config";
import type {
  PaneDef,
  PaneSettingField,
  PaneSettingsContext,
  PaneSettingsDef,
  PaneTemplateDef,
} from "../types/plugin";
import { commandBarResultsFromNodes, commandBarSnapshot } from "./command-bar";
import type { RemoteUiRegistry } from "./semantic-tree";
import { REMOTE_AGENT_HELP, remoteControlSchema } from "./schema";
import type { RemoteIncludedState, RemoteStateInclude } from "./types";
import {
  activeLayoutRev,
  normalizeIncludes,
  paneSnapshot,
  type PatchTarget,
} from "./controller-utils";

function summarizeSettingField(field: PaneSettingField): {
  key: string;
  label: string;
  type: PaneSettingField["type"];
  description?: string;
  options?: { value: string; label: string }[];
} {
  const options = "options" in field
    ? field.options.map((option) => ({ value: option.value, label: option.label }))
    : undefined;
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    ...(field.description ? { description: field.description } : {}),
    ...(options ? { options } : {}),
  };
}

function resolvePaneTypeSettings(pane: PaneDef): {
  hasSettings: boolean;
  settingsTitle?: string;
  fields: ReturnType<typeof summarizeSettingField>[];
} {
  if (!pane.settings) return { hasSettings: false, fields: [] };
  if (typeof pane.settings !== "function") {
    return {
      hasSettings: true,
      ...(pane.settings.title ? { settingsTitle: pane.settings.title } : {}),
      fields: pane.settings.fields.map(summarizeSettingField),
    };
  }
  const emptyContext = {
    config: {} as PaneSettingsContext["config"],
    layout: { instances: [] } as PaneSettingsContext["layout"],
    paneId: pane.id,
    paneType: pane.id,
    pane: { instanceId: pane.id, paneId: pane.id, binding: { kind: "none" } },
    settings: {},
    paneState: {},
    activeTicker: null,
    activeCollectionId: null,
  } as PaneSettingsContext;
  try {
    const settingsDef: PaneSettingsDef | null = pane.settings(emptyContext);
    if (!settingsDef) return { hasSettings: true, fields: [] };
    return {
      hasSettings: true,
      ...(settingsDef.title ? { settingsTitle: settingsDef.title } : {}),
      fields: settingsDef.fields.map(summarizeSettingField),
    };
  } catch {
    return { hasSettings: true, fields: [] };
  }
}

function paneTypeSnapshot(
  pane: PaneDef,
  templates: readonly PaneTemplateDef[],
) {
  const settings = resolvePaneTypeSettings(pane);
  const matching = templates
    .filter((template) => template.paneId === pane.id)
    .map((template) => ({
      id: template.id,
      label: template.label,
      ...(template.shortcut ? { shortcut: template.shortcut } : {}),
    }));
  return {
    id: pane.id,
    name: pane.name,
    defaultPosition: pane.defaultPosition,
    defaultMode: pane.defaultMode,
    hasSettings: settings.hasSettings,
    ...(settings.settingsTitle ? { settingsTitle: settings.settingsTitle } : {}),
    fields: settings.fields,
    ...(matching.length ? { templates: matching } : {}),
  };
}

interface RemoteResourceContext {
  dispatch: Dispatch<AppAction>;
  getState: () => AppState;
  pluginRegistry: PluginRegistry;
  uiRegistry: RemoteUiRegistry | null;
}

export function createRemoteResources({
  dispatch,
  getState,
  pluginRegistry,
  uiRegistry,
}: RemoteResourceContext) {
  const getResource = (resource: string): unknown => {
    const state = getState();
    const uiNodes = uiRegistry?.snapshot() ?? [];
    if (resource === "app://snapshot") {
      return {
        rev: activeLayoutRev(state),
        app: {
          activePanel: state.activePanel,
          focusedPaneId: state.focusedPaneId,
          previousFocusedPaneId: state.previousFocusedPaneId,
          statusBarVisible: state.statusBarVisible,
          commandBarOpen: state.commandBarOpen,
          commandBarQuery: state.commandBarQuery,
          initialized: state.initialized,
        },
        config: state.config,
        panes: state.config.layout.instances.map((pane) => paneSnapshot(state, pane)),
        commandBar: commandBarSnapshot(state, uiNodes),
        ui: uiNodes,
        schema: remoteControlSchema(),
        help: REMOTE_AGENT_HELP,
      };
    }
    if (resource === "app://config") return state.config;
    if (resource === "app://layout/current") return state.config.layout;
    if (resource === "app://layouts") return state.config.layouts;
    if (resource === "app://panes") return state.config.layout.instances.map((pane) => paneSnapshot(state, pane));
    if (resource === "app://pane-types") {
      const templates = [...pluginRegistry.paneTemplates.values()];
      return [...pluginRegistry.panes.values()].map((pane) => paneTypeSnapshot(pane, templates));
    }
    if (resource === "app://pane-templates") {
      return [...pluginRegistry.paneTemplates.values()].map((template) => ({
        id: template.id,
        paneId: template.paneId,
        label: template.label,
        description: template.description,
        shortcut: template.shortcut,
      }));
    }
    if (resource.startsWith("app://pane-state/")) {
      const paneId = decodeURIComponent(resource.slice("app://pane-state/".length));
      return state.paneState[paneId] ?? {};
    }
    if (resource.startsWith("app://pane-settings/")) {
      const paneId = decodeURIComponent(resource.slice("app://pane-settings/".length));
      const descriptor = pluginRegistry.resolvePaneSettings(paneId);
      if (!descriptor) throw new Error(`Pane "${paneId}" does not expose settings.`);
      return {
        paneId: descriptor.paneId,
        settings: descriptor.context.settings,
        fields: descriptor.settingsDef.fields,
      };
    }
    if (resource === "app://commands") {
      return [...pluginRegistry.commands.values()].map((command) => ({
        id: command.id,
        label: command.label,
        description: command.description,
        shortcut: command.shortcut,
        hasWizard: !!command.wizard?.length,
      }));
    }
    if (resource === "app://connections") {
      return listConnectionSources().map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        pluginId: source.pluginId,
        authRequired: source.authRequired !== false,
        isWebSocket: !!source.isWebSocket,
      }));
    }
    if (resource === "app://command-bar") return commandBarSnapshot(state, uiNodes);
    if (resource === "app://command-bar/results") return commandBarResultsFromNodes(uiNodes);
    if (resource === "app://capabilities") return pluginRegistry.capabilities.manifests();
    if (resource === "app://remote/help") return REMOTE_AGENT_HELP;
    if (resource === "ui://tree") return uiNodes;
    throw new Error(`Unknown remote resource "${resource}".`);
  };

  const buildIncludedState = (include: RemoteStateInclude[] | undefined, defaults: RemoteStateInclude[] = []): RemoteIncludedState | undefined => {
    const included = normalizeIncludes(include, defaults);
    if (included.length === 0) return undefined;
    const state = getState();
    const uiNodes = uiRegistry?.snapshot() ?? [];
    const result: RemoteIncludedState = {
      rev: activeLayoutRev(state),
      included,
    };
    if (included.includes("app")) {
      result.app = {
        activePanel: state.activePanel,
        focusedPaneId: state.focusedPaneId,
        previousFocusedPaneId: state.previousFocusedPaneId,
        statusBarVisible: state.statusBarVisible,
        commandBarOpen: state.commandBarOpen,
        commandBarQuery: state.commandBarQuery,
        initialized: state.initialized,
        activeLayoutIndex: state.config.activeLayoutIndex,
        activeLayoutName: state.config.layouts[state.config.activeLayoutIndex]?.name ?? null,
      };
    }
    if (included.includes("layout")) result.layout = state.config.layout;
    if (included.includes("panes")) {
      result.panes = state.config.layout.instances.map((pane) => paneSnapshot(state, pane));
    }
    if (included.includes("commandBar") || included.includes("commandBar.results")) {
      const commandBar = commandBarSnapshot(state, uiNodes);
      result.commandBar = included.includes("commandBar")
        ? commandBar
        : { results: commandBar.results };
    }
    if (included.includes("ui")) result.ui = uiNodes;
    if (included.includes("schema")) result.schema = remoteControlSchema();
    if (included.includes("help")) result.help = REMOTE_AGENT_HELP;
    return result;
  };

  const patchTarget = (resource: string): PatchTarget<unknown> => {
    const state = getState();
    if (resource === "app://config") {
      return {
        value: state.config,
        apply: (value) => dispatch({ type: "SET_CONFIG", config: value as AppState["config"] }),
      };
    }
    if (resource === "app://layout/current") {
      return {
        value: state.config.layout,
        apply: (value) => pluginRegistry.updateLayoutFn(value as LayoutConfig),
      };
    }
    if (resource.startsWith("app://pane-state/")) {
      const paneId = decodeURIComponent(resource.slice("app://pane-state/".length));
      return {
        value: state.paneState[paneId] ?? {},
        apply: (value) => dispatch({ type: "REPLACE_PANE_STATE", paneId, state: value as PaneRuntimeState }),
      };
    }
    if (resource.startsWith("app://pane-settings/")) {
      const paneId = decodeURIComponent(resource.slice("app://pane-settings/".length));
      const descriptor = pluginRegistry.resolvePaneSettings(paneId);
      if (!descriptor) throw new Error(`Pane "${paneId}" does not expose settings.`);
      return {
        value: descriptor.context.settings,
        apply: (value) => {
          const nextLayout = setPaneSettings(getState().config.layout, descriptor.paneId, value as Record<string, unknown>);
          pluginRegistry.updateLayoutFn(nextLayout);
        },
      };
    }
    throw new Error(`Remote resource "${resource}" is not patchable.`);
  };

  return {
    buildIncludedState,
    getResource,
    patchTarget,
  };
}
