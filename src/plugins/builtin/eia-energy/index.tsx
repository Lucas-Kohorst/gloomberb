import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { chartSeriesProvider } from "../../../capabilities";
import type { ChartSeriesCatalogItem } from "../../../capabilities/types";
import { registerConnectionSource } from "../connections/register";
import { resolveEiaChartSeries } from "./client";
import { buildEiaEnergySettingsDef, EnergyPane } from "./pane";
import {
  DEFAULT_EIA_SERIES_ID,
  EIA_CHART_CAPABILITY_ID,
  EIA_ENERGY_CONNECTION_ID,
  EIA_ENERGY_PLUGIN_ID,
  EIA_PANE_ID,
  eiaSeriesCatalog,
  findEiaSeries,
  matchEiaSeriesId,
} from "./types";

function createEnergyPaneInstance(options?: PaneTemplateCreateOptions) {
  const seriesId = matchEiaSeriesId(options?.arg ?? options?.symbol ?? options?.values?.series);
  const def = findEiaSeries(seriesId) ?? findEiaSeries(DEFAULT_EIA_SERIES_ID)!;
  const encoded = encodeURIComponent(seriesId).replace(/%/g, "~");
  return {
    instanceId: `${EIA_PANE_ID}:${encoded}`,
    title: `Energy ${def.short}`,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { seriesId },
  };
}

function catalogItems(request: { query?: string; limit?: number }): ChartSeriesCatalogItem[] {
  const entries = eiaSeriesCatalog.entries ?? [];
  const words = (request.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matched = words.length === 0
    ? entries
    : entries.filter((entry) => words.every((word) => entry.searchText.toLowerCase().includes(word)));
  return matched.slice(0, request.limit ?? 32).map((entry) => ({
    seriesId: entry.id,
    label: entry.label,
    description: entry.description,
    detail: entry.detail,
  }));
}

let disposeConnection: (() => void) | null = null;
let disposeCatalog: (() => void) | null = null;

export const eiaEnergyPlugin: GloomPlugin = {
  id: EIA_ENERGY_PLUGIN_ID,
  name: "EIA Energy",
  version: "1.0.0",
  description:
    "U.S. energy inventories, production, and prices from the free EIA API v2. Crude stocks, gasoline and distillate inventories, natural gas storage, retail fuel prices, and crude production.",
  toggleable: true,

  panes: [
    {
      id: EIA_PANE_ID,
      name: "Energy",
      icon: "E",
      component: EnergyPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      settings: buildEiaEnergySettingsDef(),
    },
  ],

  paneTemplates: [
    {
      id: "eia-energy-pane",
      paneId: EIA_PANE_ID,
      label: "Energy",
      description:
        "U.S. energy inventories, production, and prices from the free EIA API. Pick the series in pane settings; works out of the box with DEMO_KEY.",
      keywords: [
        "eia",
        "energy",
        "oil",
        "crude",
        "gasoline",
        "diesel",
        "distillate",
        "natural gas",
        "storage",
        "stocks",
        "inventory",
        "inventories",
        "production",
        "fuel",
        "price",
      ],
      category: "Data",
      shortcut: {
        prefix: "EIA",
        argPlaceholder: "series",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createEnergyPaneInstance(options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
    disposeConnection = registerConnectionSource({
      id: EIA_ENERGY_CONNECTION_ID,
      name: "EIA Energy",
      kind: "api",
      pluginId: EIA_ENERGY_PLUGIN_ID,
      authRequired: false,
    });
    disposeCatalog = ctx.registerChartSeriesCatalog(eiaSeriesCatalog);
    ctx.registerCapability(chartSeriesProvider({
      id: EIA_CHART_CAPABILITY_ID,
      name: "EIA Energy",
      provider: {
        catalog: catalogItems,
        search: catalogItems,
        resolve: ({ seriesId, signal }) => resolveEiaChartSeries(seriesId, signal),
      },
    }));
  },

  dispose() {
    disposeCatalog?.();
    disposeCatalog = null;
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default eiaEnergyPlugin;
