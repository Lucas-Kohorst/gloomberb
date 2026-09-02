import type { PaneSettingsDef } from "../../../types/plugin";
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
import { OPTION_FIELD_DEFS, resolveOptionFieldIds } from "./table";

function optionsSettings(settings: Record<string, unknown>): PaneSettingsDef {
  return {
    title: "Options Settings",
    values: {
      optionColumnIds: resolveOptionFieldIds(settings.optionColumnIds),
    },
    fields: [
      {
        key: "optionColumnIds",
        label: "Columns",
        description: "Choose and order the fields mirrored around the strike.",
        type: "ordered-multi-select",
        options: OPTION_FIELD_DEFS.map((field) => ({
          value: field.id,
          label: field.label,
          description: field.description,
        })),
      },
      {
        key: "chainRefreshMinutes",
        label: "Chain refresh",
        description: "How often the whole chain snapshot is refetched. Quotes for visible strikes stream separately.",
        type: "select",
        options: [
          { value: "1", label: "Every minute" },
          { value: "5", label: "Every 5 minutes" },
          { value: "10", label: "Every 10 minutes" },
          { value: "30", label: "Every 30 minutes" },
        ],
      },
    ],
  };
}


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
      settings: (context) => withLiveStreamingSetting(optionsSettings(context.settings), context.settings),
      tableExport: true,
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
      publicShare: true,
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
  },
};
