import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { PollsPane } from "./pane";
import { POLLS_PANE_ID } from "./types";
import { ADJACENT_PLUGIN_ID } from "../adjacent/types";

let disposeVoteHubConnection: (() => void) | null = null;

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
    },
  ],

  paneTemplates: [
    {
      id: "polls-pane",
      paneId: POLLS_PANE_ID,
      label: "Polls",
      description: "Browse VoteHub political polls by type — approval, favorability, generic ballot, Senate, governor, House — with trend charts, pollster breakdowns, search, and source links.",
      keywords: ["polls", "votehub", "approval", "favorability", "generic", "ballot", "senate", "governor"],
      category: "Data",
      shortcut: { prefix: "POLL" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup() {
    disposeVoteHubConnection = registerConnectionSource({
      id: "votehub",
      name: "VoteHub",
      kind: "data",
      pluginId: ADJACENT_PLUGIN_ID,
      priority: 300,
      authRequired: false,
    });
  },

  dispose() {
    disposeVoteHubConnection?.();
    disposeVoteHubConnection = null;
  },
};
