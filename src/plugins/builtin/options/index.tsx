import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { OptionsView } from "./view";
import {
  VolSurfaceView,
  OPTIONS_VOL_SURFACE_PANE_ID,
  MAX_SURF_EXPIRATIONS,
} from "./volsurf-view";
import {
  LIVE_STREAMING_QUICK_SETTING,
  withLiveStreamingSetting,
} from "../shared/live-streaming";
import { registerConnectionSource } from "../connections/register";

let disposeOptionsConnection: (() => void) | null = null;

export const optionsModule: PluginModule = {
  panes: [
    {
      id: "options",
      name: "Options",
      icon: "O",
      component: OptionsView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 112, height: 28 },
      quickSettings: [LIVE_STREAMING_QUICK_SETTING],
      settings: (context) => withLiveStreamingSetting({ fields: [] }, context.settings),
    },
    {
      id: OPTIONS_VOL_SURFACE_PANE_ID,
      name: "Vol Surface",
      icon: "V",
      component: VolSurfaceView,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 24 },
      quickSettings: [LIVE_STREAMING_QUICK_SETTING],
      settings: (context) => withLiveStreamingSetting({ fields: [] }, context.settings),
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "options-pane",
      paneId: "options",
      label: "Options",
      description: "Options chain for the selected ticker.",
      keywords: ["options", "chain", "calls", "puts", "omon"],
      shortcut: "OMON",
    }),
    createTickerSurfacePaneTemplate({
      id: "options-vol-surface-pane",
      paneId: OPTIONS_VOL_SURFACE_PANE_ID,
      label: "Volatility Surface",
      description: `Implied volatility heatmap across strikes and up to ${MAX_SURF_EXPIRATIONS} expirations.`,
      keywords: [
        "volatility",
        "surface",
        "implied",
        "iv",
        "heatmap",
        "options",
        "vsurf",
      ],
      shortcut: "VSURF",
    }),
  ],

  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "options",
      name: "Options",
      order: 35,
      component: OptionsView,
      isVisible: ({ hasOptionsChain }) => hasOptionsChain,
    });

    // Options chains are delivered by the underlying asset-data feed but are a
    // distinct data source worth surfacing in the Connections inventory.
    disposeOptionsConnection = registerConnectionSource({
      id: "options",
      name: "Options Chain",
      kind: "asset-data",
      pluginId: "ticker-research",
    });
  },

  dispose() {
    disposeOptionsConnection?.();
    disposeOptionsConnection = null;
  },
};
