import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { WeatherPane } from "./pane";
import { ADJACENT_PLUGIN_ID } from "../adjacent/types";
import {
  NWS_CLI_CONNECTION_ID,
  TWC_KALSHI_URL,
  WEATHER_CONNECTION_ID,
  WEATHER_PANE_ID,
} from "./types";
import { PredictionWeatherSettlementTab } from "./settlement-tab";

let disposeWeatherConnection: (() => void) | null = null;
let disposeNwsConnection: (() => void) | null = null;

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
    disposeWeatherConnection = registerConnectionSource({
      id: WEATHER_CONNECTION_ID,
      name: "The Weather Company (Kalshi)",
      kind: "data",
      pluginId: ADJACENT_PLUGIN_ID,
      priority: 260,
      authRequired: false,
    });
    disposeNwsConnection = registerConnectionSource({
      id: NWS_CLI_CONNECTION_ID,
      name: "NWS Daily Climate Report",
      kind: "data",
      pluginId: ADJACENT_PLUGIN_ID,
      priority: 261,
      authRequired: false,
    });
  },

  dispose() {
    disposeWeatherConnection?.();
    disposeWeatherConnection = null;
    disposeNwsConnection?.();
    disposeNwsConnection = null;
  },
};

export { TWC_KALSHI_URL, PredictionWeatherSettlementTab };
