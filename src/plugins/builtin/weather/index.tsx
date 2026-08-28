import type { PluginModule } from "../plugin-module";
import { WeatherPane } from "./pane";
import {
  TWC_KALSHI_URL,
  WEATHER_PANE_ID,
} from "./types";
import { PredictionWeatherSettlementTab } from "./settlement-tab";
import { registerWeatherSources } from "./sources";

let disposeWeatherSources: Array<() => void> = [];

export const weatherModule: PluginModule = {
  panes: [
    {
      id: WEATHER_PANE_ID,
      name: "Weather",
      icon: "W",
      component: WeatherPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 72, height: 28 },
    },
  ],

  paneTemplates: [
    {
      id: "weather-pane",
      paneId: WEATHER_PANE_ID,
      label: "Weather",
      description:
        "Browse settlement-aware weather observations. Chart TWC with G WX:LAX:high and NWS first-final CLI with G NWS:KNYC:high.",
      keywords: [
        "weather",
        "climate",
        "temperature",
        "kalshi",
        "twc",
        "settlement",
        "high",
        "nws",
        "cli",
        "icao",
      ],
      category: "Data",
      shortcut: { prefix: "WX" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup() {
    disposeWeatherSources = registerWeatherSources();
  },

  dispose() {
    for (const dispose of disposeWeatherSources.splice(0)) dispose();
  },
};

export { TWC_KALSHI_URL, PredictionWeatherSettlementTab };
