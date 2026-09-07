import type { GloomPlugin } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { PollsPane } from "./pane";
import { POLLS_PANE_ID, POLLS_PLUGIN_ID } from "./types";
import { buildPollsPaneSettingsDef } from "./settings";

let disposeVoteHubConnection: (() => void) | null = null;

export const pollsModule: PluginModule = {
  setup() {
    disposeVoteHubConnection = registerConnectionSource({
      id: "votehub",
      name: "VoteHub",
      kind: "api",
      pluginId: POLLS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeVoteHubConnection?.();
    disposeVoteHubConnection = null;
  },

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
      description: "Browse VoteHub political polls — all types by default, or filter to approval, favorability, generic ballot, Senate, governor, House — with trend charts, pollster breakdowns, search, and source links.",
      keywords: ["polls", "votehub", "all", "approval", "favorability", "generic", "ballot", "senate", "governor"],
      shortcut: { prefix: "POLL" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};

export const pollsPlugin: GloomPlugin = {
  id: POLLS_PLUGIN_ID,
  name: "Polls",
  version: "1.0.0",
  description: "Political polls from VoteHub (CC BY 4.0)",
  toggleable: true,
  ...pollsModule,
};
