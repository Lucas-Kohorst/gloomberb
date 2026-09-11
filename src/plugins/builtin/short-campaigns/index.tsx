import type {
  GloomPlugin,
  PaneTemplateCreateOptions,
  PaneTemplateContext,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { ShortCampaignsPane } from "./pane";
import {
  SHORT_CAMPAIGNS_CONNECTION_ID,
  SHORT_CAMPAIGNS_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createShortCampaignsPaneInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `${prefix}:${encoded}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const shortCampaignsPlugin: GloomPlugin = {
  id: SHORT_CAMPAIGNS_PLUGIN_ID,
  name: "Short Campaigns",
  version: "1.0.0",
  description:
    "Activist short campaigns scraped from ShortReportImpact: targets, sellers, dates, and performance.",
  toggleable: true,

  panes: [
    {
      id: "short-campaigns",
      name: "Short Campaigns",
      icon: "S",
      component: ShortCampaignsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "short-campaigns-pane",
      paneId: "short-campaigns",
      label: "Short Campaigns",
      description:
        "Activist short campaigns scraped from ShortReportImpact: targets, sellers, dates, and performance.",
      keywords: [
        "short",
        "activist",
        "short seller",
        "campaigns",
        "short reports",
        "muddy waters",
        "hindenburg",
      ],
      category: "Data",
      shortcut: {
        prefix: "SHORT",
        argPlaceholder: "company or seller",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createShortCampaignsPaneInstance("short-campaigns", "Short Campaigns", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: SHORT_CAMPAIGNS_CONNECTION_ID,
      name: "ShortReportImpact",
      kind: "data",
      pluginId: SHORT_CAMPAIGNS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default shortCampaignsPlugin;
