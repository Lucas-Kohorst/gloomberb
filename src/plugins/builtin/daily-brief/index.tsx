import type { GloomPlugin } from "../../../types/plugin";
import { DailyBriefPane } from "./pane";
import { BRIEF_SECTIONS_SETTING, defaultBriefLayout, serializeBriefLayout } from "./sections";
import {
  createDailyBriefInstance,
  DAILY_BRIEF_PANE_ID,
  DAILY_BRIEF_PLUGIN_ID,
  DAILY_BRIEF_TEMPLATE_ID,
  OPEN_ON_WAKE_SETTING,
} from "./wake";
import { startDailyBriefWake } from "./wake-host";

const BRIEF_DESCRIPTION = "Opens at the start of the day. Futures, bitcoin, sentiment, the next Fed meeting, and small tables. Headlines, releases, and earnings are the start; Ask Gloom or the Tables setting can replace those tables with any view.";

let stopWake: (() => void) | null = null;

export const dailyBriefPlugin: GloomPlugin = {
  id: DAILY_BRIEF_PLUGIN_ID,
  name: "Daily Brief",
  version: "1.0.0",
  description: BRIEF_DESCRIPTION,
  toggleable: true,
  setup(ctx) {
    stopWake?.();
    stopWake = startDailyBriefWake(ctx);
  },
  dispose() {
    stopWake?.();
    stopWake = null;
  },
  panes: [
    {
      id: DAILY_BRIEF_PANE_ID,
      name: "Daily Brief",
      icon: "D",
      component: DailyBriefPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 36 },
      settings: {
        title: "Daily Brief",
        values: {
          [OPEN_ON_WAKE_SETTING]: true,
          [BRIEF_SECTIONS_SETTING]: serializeBriefLayout(defaultBriefLayout()),
        },
        fields: [{
          key: OPEN_ON_WAKE_SETTING,
          label: "Open on wake",
          description: "Open when the app starts for the day, and when the laptop wakes from sleep after midnight.",
          type: "toggle",
          storage: "plugin",
        }, {
          key: BRIEF_SECTIONS_SETTING,
          label: "Tables",
          description: "Small tables under the chart. headlines, today, and earnings are built in. Any other entry is a view spec, the same shape as VIEW. Ask Gloom writes this, or edit it here. Blank restores the default.",
          placeholder: `["headlines", "today", "earnings"]`,
          type: "text",
          storage: "plugin",
        }],
      },
    },
  ],
  paneTemplates: [
    {
      id: DAILY_BRIEF_TEMPLATE_ID,
      paneId: DAILY_BRIEF_PANE_ID,
      label: "Daily Brief",
      description: BRIEF_DESCRIPTION,
      keywords: ["daily", "brief", "lineup", "morning", "day", "bitcoin", "fear", "fomc", "wake", "tables", "view"],
      shortcut: { prefix: "DAY" },
      createInstance: (_context, options) => createDailyBriefInstance(options),
    },
  ],
};
