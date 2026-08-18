import type { PluginModule } from "../plugin-module";
import { OptionsCalcPane, DEFAULT_FLOATING_SIZE, OPTIONS_CALC_PANE_ID } from "./pane";

export const optionsCalcModule: PluginModule = {
  panes: [
    {
      id: OPTIONS_CALC_PANE_ID,
      name: "Options Calculator",
      icon: "O",
      component: OptionsCalcPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: DEFAULT_FLOATING_SIZE,
    },
  ],

  paneTemplates: [
    {
      id: "options-calc-pane",
      paneId: OPTIONS_CALC_PANE_ID,
      label: "Black-Scholes Calculator",
      description: "Compute option prices and Greeks with the Black-Scholes model.",
      keywords: [
        "options",
        "black-scholes",
        "ovme",
        "calculator",
        "greeks",
        "delta",
        "gamma",
        "theta",
        "vega",
        "rho",
        "iv",
        "implied",
        "volatility",
      ],
      shortcut: { prefix: "OVME" },
    },
  ],
};
