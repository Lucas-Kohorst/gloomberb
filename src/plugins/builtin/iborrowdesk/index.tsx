import type {
  GloomPlugin,
  PaneSettingsDef,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { IBorrowDeskPane } from "./pane";
import {
  IBORROWDESK_CONNECTION_ID,
  IBORROWDESK_PANE_ID,
  IBORROWDESK_PLUGIN_ID,
} from "./types";

function symbolFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.symbol ?? "").trim().toUpperCase();
}

function createBorrowPaneInstance(options?: PaneTemplateCreateOptions) {
  const symbol = symbolFromTemplateOptions(options);
  const encoded = encodeURIComponent(symbol).replace(/%/g, "~");
  return {
    instanceId: symbol ? `${IBORROWDESK_PANE_ID}:${encoded}` : `${IBORROWDESK_PANE_ID}:movers`,
    title: symbol ? `Borrow ${symbol}` : "Borrow Rates",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { symbol },
  };
}

function borrowSettings(): PaneSettingsDef {
  return {
    title: "Borrow Rates Settings",
    fields: [
      {
        key: "symbol",
        label: "Ticker",
        description: "Ticker to open on the snapshot view. Leave blank to start on fee movers.",
        type: "text",
        placeholder: "GME",
      },
      {
        key: "view",
        label: "Default view",
        description: "Snapshot shows one ticker's fee history; movers shows the biggest fee changes market-wide.",
        type: "select",
        options: [
          { value: "snapshot", label: "Snapshot" },
          { value: "movers", label: "Fee movers" },
        ],
      },
    ],
  };
}

let disposeConnection: (() => void) | null = null;

export const iborrowDeskPlugin: GloomPlugin = {
  id: IBORROWDESK_PLUGIN_ID,
  name: "Borrow Rates",
  version: "1.0.0",
  description:
    "Stock borrow fees and short availability from IBorrowDesk (Interactive Brokers data): per-ticker fee history and market-wide fee movers.",
  toggleable: true,

  panes: [
    {
      id: IBORROWDESK_PANE_ID,
      name: "Borrow",
      icon: "B",
      component: IBorrowDeskPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      settings: borrowSettings(),
    },
  ],

  paneTemplates: [
    {
      id: "iborrowdesk-pane",
      paneId: IBORROWDESK_PANE_ID,
      label: "Borrow Rates",
      description:
        "Stock borrow fees and short availability from IBorrowDesk (Interactive Brokers data): per-ticker fee history and market-wide fee movers.",
      keywords: [
        "borrow",
        "borrowdesk",
        "short",
        "fee",
        "availability",
        "locate",
        "iborrowdesk",
        "stock loan",
        "rebate",
      ],
      category: "Data",
      shortcut: {
        prefix: "BORROW",
        argPlaceholder: "ticker",
        argKind: "ticker",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createBorrowPaneInstance(options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: IBORROWDESK_CONNECTION_ID,
      name: "IBorrowDesk",
      kind: "api",
      pluginId: IBORROWDESK_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default iborrowDeskPlugin;
