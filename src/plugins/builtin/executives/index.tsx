import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { researchCanReadPro, shownIf } from "../shared/research-tab-availability";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import {
  attachExecutivesPersistence,
  loadProxyStatements,
  resetExecutivesPersistence,
} from "./data";
import { EXECUTIVES_PANE_ID, ExecutivesPane, ExecutivesResearchTab } from "./pane";
import { isKnownNonUsListing } from "../../../utils/sec";

function loadExecTab({ symbol }: TickerResearchTabLoadContext): Promise<boolean> {
  if (!symbol || !researchCanReadPro()) return Promise.resolve(true);
  return shownIf(
    () => loadProxyStatements(symbol.toUpperCase()),
    (result) => !!result.refreshError || (result.data?.proxies.length ?? 0) > 0,
  );
}

const description =
  "Named executive officers and what they were paid, read from the company's proxy statement and checked against the filing.";

export const executivesModule: PluginModule = {
  setup(ctx) {
    attachExecutivesPersistence(ctx.persistence);
    ctx.registerTickerResearchTab({
      id: "executives",
      name: "Exec",
      order: 35,
      component: ExecutivesResearchTab,
      instruments: ["equity"],
      isVisible: ({ ticker }) => !isKnownNonUsListing(ticker),
      load: loadExecTab,
    });
  },

  dispose() {
    resetExecutivesPersistence();
  },

  panes: [
    {
      id: EXECUTIVES_PANE_ID,
      name: "Executives",
      icon: "X",
      component: ExecutivesPane,
      defaultPosition: "right",
      tickerFollower: true,
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "executives-pane",
      paneId: EXECUTIVES_PANE_ID,
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
    }),
  ],
};
