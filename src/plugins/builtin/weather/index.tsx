import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { WeatherPane } from "./pane";
import {
  TWC_KALSHI_URL,
  WEATHER_PANE_ID,
} from "./types";
import { PredictionWeatherSettlementTab } from "./settlement-tab";
import { NWS_OBSERVATIONS_CONNECTION_ID } from "../../../sources/nws-observations";

let disposeNwsObservationsConnection: (() => void) | null = null;

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
        "Browse Weather Company Kalshi climate observations. Chart TWC with G WX:LAX:high and NWS first-final CLI with G NWS:KNYC:high.",
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
    disposeNwsObservationsConnection = registerConnectionSource({
      id: NWS_OBSERVATIONS_CONNECTION_ID,
      name: "NWS Station Observations",
      kind: "api",
      pluginId: "adjacent",
      priority: 230,
    });
  },

  dispose() {
    disposeNwsObservationsConnection?.();
    disposeNwsObservationsConnection = null;
  },
};

export { TWC_KALSHI_URL, PredictionWeatherSettlementTab };
