import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { CboeBookPane } from "./pane";
import {
  CBOE_BOOK_CONNECTION_ID,
  CBOE_BOOK_PANE_ID,
  CBOE_BOOK_PLUGIN_ID,
  CBOE_MARKETS,
  DEFAULT_CBOE_MARKET,
  normalizeCboeMarket,
} from "./types";

function explicitSymbol(options?: PaneTemplateCreateOptions): string | null {
  const raw =
    options?.symbol ??
    options?.ticker?.metadata.ticker ??
    options?.arg ??
    options?.values?.symbol ??
    "";
  const trimmed = String(raw ?? "").trim().toUpperCase();
  return trimmed || null;
}

function createBookPaneInstance(
  options?: PaneTemplateCreateOptions,
) {
  const symbol = explicitSymbol(options);
  if (!symbol) {
    return {
      instanceId: `${CBOE_BOOK_PANE_ID}:latest`,
      title: "Cboe Book",
      placement: "floating" as const,
      binding: { kind: "none" as const },
      settings: { market: DEFAULT_CBOE_MARKET },
    };
  }
  const encoded = encodeURIComponent(symbol).replace(/%/g, "~");
  return {
    instanceId: `${CBOE_BOOK_PANE_ID}:${encoded}`,
    title: `CBOE ${symbol}`,
    placement: "floating" as const,
    binding: { kind: "fixed" as const, symbol },
    settings: { symbol, market: DEFAULT_CBOE_MARKET },
  };
}

let disposeConnection: (() => void) | null = null;

export const cboeBookPlugin: GloomPlugin = {
  id: CBOE_BOOK_PLUGIN_ID,
  name: "Cboe Book",
  version: "1.0.0",
  description:
    "Equity level-2 bid/ask ladder from the Cboe Book Viewer (BZX, BYX, EDGX, EDGA) with spread and last trades.",
  toggleable: true,

  panes: [
    {
      id: CBOE_BOOK_PANE_ID,
      name: "Cboe Book",
      icon: "B",
      component: CboeBookPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 72, height: 30 },
      settings: {
        title: "Cboe Book Settings",
        fields: [
          {
            key: "symbol",
            label: "Ticker",
            type: "text",
            placeholder: "AAPL",
          },
          {
            key: "market",
            label: "Market",
            type: "select",
            options: CBOE_MARKETS.map((market) => ({
              value: market,
              label: market.toUpperCase(),
            })),
          },
        ],
      },
    },
  ],

  paneTemplates: [
    {
      id: "cboe-book-pane",
      paneId: CBOE_BOOK_PANE_ID,
      label: "Cboe Book",
      description:
        "Equity level-2 bid/ask ladder from the Cboe Book Viewer (BZX, BYX, EDGX, EDGA) with spread and last trades.",
      keywords: [
        "cboe",
        "book",
        "level 2",
        "level2",
        "bid",
        "ask",
        "ladder",
        "depth",
        "bzx",
        "byx",
        "edgx",
        "edga",
        "bats",
      ],
      category: "Data",
      shortcut: {
        prefix: "CBOE",
        argPlaceholder: "ticker",
        argKind: "ticker",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        const settings = (options?.values ?? {}) as Record<string, unknown>;
        const market = normalizeCboeMarket(
          (settings.market as string | undefined) ?? DEFAULT_CBOE_MARKET,
        );
        const instance = createBookPaneInstance(options);
        return {
          ...instance,
          settings: { ...instance.settings, market },
        };
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: CBOE_BOOK_CONNECTION_ID,
      name: "Cboe Book",
      kind: "api",
      pluginId: CBOE_BOOK_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default cboeBookPlugin;
