import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { TvPane } from "./pane";

let disposeTvConnection: (() => void) | null = null;

export const tvModule: PluginModule = {
  panes: [{
    id: "macro-tv",
    name: "TV",
    icon: "T",
    component: TvPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 92, height: 32 },
  }],
  paneTemplates: [{
    id: "macro-tv-pane",
    paneId: "macro-tv",
    label: "TV",
    description: "Live Bloomberg, CNBC, Yahoo Finance, TBPN, MTS, Eventual, and threadguy television.",
    keywords: [
      "tv",
      "television",
      "live tv",
      "finance tv",
      "financial television",
      "live stream",
      "market news",
      "business news",
      "markets",
      "news",
      "bloomberg",
      "bloomberg tv",
      "cnbc",
      "cnbc tv",
      "yahoo",
      "yahoo finance",
      "tbpn",
      "the business people network",
      "mts",
      "monitor the situation",
      "eventual",
      "eventual news",
      "threadguy",
      "notthreadguy",
      "macro",
    ],
    shortcut: { prefix: "TV" },
  }],
  setup() {
    disposeTvConnection = registerConnectionSource({
      id: "youtube",
      name: "YouTube TV",
      kind: "api",
      pluginId: "macro",
      priority: 500,
    });
  },
  dispose() {
    disposeTvConnection?.();
    disposeTvConnection = null;
  },
};
