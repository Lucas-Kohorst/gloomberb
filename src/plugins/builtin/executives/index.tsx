import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { isEquityResearchTicker } from "../../../tickers/research-visibility";
import { registerConnectionSource } from "../connections/register";
import {
  attachExecutivesPersistence,
  EXECUTIVES_CONNECTION_ID,
  resetExecutivesPersistence,
} from "./data";
import { EXECUTIVES_PANE_ID, ExecutivesPane } from "./pane";

const description =
  "Named executive officers and what they were paid, read from the company's proxy statement and checked against the filing.";

let disposeConnection: (() => void) | null = null;

export const executivesModule: PluginModule = {
  setup(ctx) {
    attachExecutivesPersistence(ctx.persistence);
    disposeConnection = registerConnectionSource({
      id: EXECUTIVES_CONNECTION_ID,
      name: "Gloom Cloud Proxies",
      kind: "api",
      pluginId: "ticker-research",
      authRequired: false,
    });
    ctx.registerTickerResearchTab({
      id: "executives",
      name: "Exec",
      order: 35,
      component: ExecutivesPane,
      isVisible: ({ ticker }) => isEquityResearchTicker(ticker),
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    resetExecutivesPersistence();
  },

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "executives-pane",
      paneId: TICKER_RESEARCH_PANE_ID,
      label: "Executives",
      description,
      keywords: [
        "executive",
        "executives",
        "exec",
        "ceo",
        "compensation",
        "pay",
        "proxy",
        "def 14a",
        "salary",
      ],
      shortcut: "EXEC",
      publicShare: false,
      settings: () => ({ defaultTabId: "executives" }),
    }),
  ],
};
