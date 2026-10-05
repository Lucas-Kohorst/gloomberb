import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { RATE_PATH_CONNECTION_ID, ratePathCache } from "./client";
import { ratePathHeadless } from "./headless";
import { RatePathPane } from "./pane";

let disposeConnection: (() => void) | null = null;

export const ratePathModule: PluginModule = {
  panes: [{
    id: "rate-path",
    name: "US Rate Path",
    icon: "R",
    component: RatePathPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 86, height: 30 },
    tableExport: true,
    headless: ratePathHeadless,
    settings: {
      title: "US Rate Path",
      fields: [{
        key: "tab",
        label: "View",
        type: "select",
        options: [
          { value: "path", label: "Path" },
          { value: "probabilities", label: "Probabilities" },
          { value: "contracts", label: "Contracts" },
          { value: "projections", label: "Projections" },
        ],
      }],
    },
  }],
  paneTemplates: [{
    id: "rate-path-pane",
    paneId: "rate-path",
    label: "US Rate Path",
    description: "Fed funds futures implied FOMC path. Leads with moves priced and each meeting's odds.",
    keywords: ["rates", "fed", "fomc", "futures", "probability", "wirp", "ffip", "moves"],
    shortcut: { prefix: "WIRP", aliases: ["FFIP"] },
    headless: ratePathHeadless,
  }],
  setup(ctx) {
    ratePathCache.attach(ctx.persistence);
    disposeConnection?.();
    disposeConnection = registerConnectionSource({
      id: RATE_PATH_CONNECTION_ID,
      name: "Gloom Cloud Rate Path",
      kind: "api",
      pluginId: "rate-path",
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    ratePathCache.reset();
  },
};
