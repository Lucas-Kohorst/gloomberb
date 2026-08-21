import type { PluginModule } from "../plugin-module";
import { PollsPane } from "./pane";
import { POLLS_PANE_ID } from "./types";
import { buildPollsPaneSettingsDef } from "./settings";

export const pollsModule: PluginModule = {
  panes: [
    {
      id: POLLS_PANE_ID,
      name: "Polls",
      icon: "P",
      component: PollsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
      settings: (context) => buildPollsPaneSettingsDef(context.settings),
    },
  ],

  paneTemplates: [
    {
      id: "polls-pane",
      paneId: POLLS_PANE_ID,
      label: "Polls",
      description: "Browse VoteHub political polls with pollster house series, race overlays, scatter, and a prediction-market series on the same chart.",
      keywords: ["polls", "votehub", "all", "approval", "favorability", "generic", "ballot", "senate", "governor"],
      category: "Data",
      shortcut: { prefix: "POLL" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
