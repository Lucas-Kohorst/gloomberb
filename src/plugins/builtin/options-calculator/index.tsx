import type { PluginModule } from "../plugin-module";
import {
  OPTIONS_CALCULATOR_PANE_ID,
  OPTIONS_CALCULATOR_TEMPLATE_ID,
} from "./model";
import { OptionsCalculatorPane } from "./pane";

export const optionsCalculatorModule: PluginModule = {
  panes: [
    {
      id: OPTIONS_CALCULATOR_PANE_ID,
      name: "Options Calculator",
      icon: "V",
      component: OptionsCalculatorPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 76, height: 16 },
    },
  ],

  paneTemplates: [
    {
      id: OPTIONS_CALCULATOR_TEMPLATE_ID,
      paneId: OPTIONS_CALCULATOR_PANE_ID,
      label: "Options Calculator",
      description: "Black-Scholes value, Greeks, and implied volatility for a European call or put.",
      keywords: ["option", "options", "calculator", "black", "scholes", "greeks", "implied", "volatility"],
      // OVME belongs to the Godel-parity options-calc pane; this port keeps its
      // own prefix so both panes stay in the assist inventory.
      shortcut: { prefix: "OPTCALC" },
      createInstance: (_context, options) => ({
        params: options?.values ?? {},
        placement: "floating",
      }),
    },
  ],
};
