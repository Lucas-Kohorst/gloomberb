import { instrumentFromTicker } from "../../../market-data/request-types";
import type { TickerResearchTabLoadContext } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { shownIf } from "../shared/research-tab-availability";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { loadPriceStudyHistory } from "./client";
import { MomentumPane } from "./momentum";
import { PatternsPane } from "./patterns";
import { TrendPane } from "./trend";

function loadStudyTab({ ticker, symbol, signal }: TickerResearchTabLoadContext): Promise<boolean> {
  const instrument = instrumentFromTicker(ticker, symbol);
  if (!instrument) return Promise.resolve(false);
  return shownIf(
    () => loadPriceStudyHistory({ instrument, signal }),
    (result) => result.history.length > 0,
  );
}

const follower = { defaultPosition: "right" as const, tickerFollower: true, defaultMode: "floating" as const };

export const priceStudiesModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "patterns", name: "Patterns", order: 41, component: PatternsPane, instruments: ["equity"], load: loadStudyTab,
    });
    ctx.registerTickerResearchTab({
      id: "trend", name: "Trend", order: 42, component: TrendPane, instruments: ["equity"], load: loadStudyTab,
    });
    ctx.registerTickerResearchTab({
      id: "momentum", name: "Momentum", order: 43, component: MomentumPane, instruments: ["equity"], load: loadStudyTab,
    });
  },

  panes: [
    { id: "patterns", name: "Patterns", icon: "P", component: PatternsPane, ...follower, defaultFloatingSize: { width: 104, height: 24 }, tableExport: true },
    { id: "momentum", name: "Momentum", icon: "M", component: MomentumPane, ...follower, defaultFloatingSize: { width: 88, height: 14 } },
    { id: "trend", name: "Trend", icon: "T", component: TrendPane, ...follower, defaultFloatingSize: { width: 88, height: 16 } },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "patterns-pane", paneId: "patterns", label: "Patterns", shortcut: "PAT", publicShare: true,
      description: "Double tops and bottoms, head and shoulders, triangles, wedges, flags, channels and ranges.",
      keywords: ["pat", "pattern", "patterns", "double top", "head and shoulders", "triangle", "wedge", "flag", "channel"],
    }),
    createTickerSurfacePaneTemplate({
      id: "momentum-pane", paneId: "momentum", label: "Momentum", shortcut: "MOSO", publicShare: true,
      description: "Ten-day momentum, rate of change, volatility, Sortino and drawdown.",
      keywords: ["moso", "momentum", "sortino", "volatility", "drawdown", "rate of change"],
    }),
    createTickerSurfacePaneTemplate({
      id: "trend-pane", paneId: "trend", label: "Trend", shortcut: "TREND", publicShare: true,
      description: "ADX, directional movement, Aroon and moving-average alignment.",
      keywords: ["trend", "adx", "aroon", "moving average", "directional"],
    }),
  ],
};
