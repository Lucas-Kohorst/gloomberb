import type { GloomPlugin } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { WeatherPane } from "./pane";
import { TWC_KALSHI_URL, WEATHER_CONNECTION_ID, WEATHER_PANE_ID, WEATHER_PLUGIN_ID } from "./types";

let disposeWeatherConnection: (() => void) | null = null;

export const weatherPlugin: GloomPlugin = {
  id: WEATHER_PLUGIN_ID,
  name: "Weather",
  version: "1.0.0",
  description:
    "Weather Company settlement observations used by Kalshi climate markets.",
  toggleable: true,

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
    "Browse Weather Company settlement observations used by Kalshi climate markets. Chart one with G WX:LAX:high. 30d tab reports forecast vs settlement.",
      keywords: [
        "weather",
        "climate",
        "temperature",
        "kalshi",
        "twc",
        "settlement",
        "high",
        "low",
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
      pluginId: WEATHER_PLUGIN_ID,
      priority: 260,
      authRequired: false,
    });
  },

  dispose() {
    disposeWeatherConnection?.();
    disposeWeatherConnection = null;
  },
};

export { TWC_KALSHI_URL };
export default weatherPlugin;
