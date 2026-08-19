import type { PluginModule } from "../plugin-module";
import {
  ADJACENT_CLOUD_CONNECTION_ID,
  ADJACENT_CLOUD_CONNECTION_NAME,
} from "./adjacent-cloud";
import { ConnectionsPane, setSharedConnectionTracker } from "./pane";
import { registerConnectionSource } from "./register";
import { ConnectionTracker } from "./tracker";

let tracker: ConnectionTracker | null = null;
let disposeAdjacentCloudConnection: (() => void) | null = null;

export const connectionsModule: PluginModule = {
  panes: [
    {
      id: "connections",
      name: "Connections",
      icon: "C",
      component: ConnectionsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 24 },
    },
  ],

  paneTemplates: [
    {
      id: "connections-pane",
      paneId: "connections",
      label: "Connections",
      description: "Monitor API connections, data providers, and streaming health.",
      keywords: ["connections", "api", "status", "health", "providers", "poll"],
      shortcut: { prefix: "CONN" },
    },
  ],

  setup(ctx) {
    disposeAdjacentCloudConnection = registerConnectionSource({
      id: ADJACENT_CLOUD_CONNECTION_ID,
      name: ADJACENT_CLOUD_CONNECTION_NAME,
      kind: "api",
      pluginId: "connections",
      priority: 250,
      authRequired: false,
    });
    tracker = new ConnectionTracker();
    tracker.attach(ctx, () => ctx.listCapabilities(), ctx.marketData);
    setSharedConnectionTracker(tracker);
  },

  dispose() {
    tracker?.dispose();
    tracker = null;
    setSharedConnectionTracker(null);
    disposeAdjacentCloudConnection?.();
    disposeAdjacentCloudConnection = null;
  },
};
