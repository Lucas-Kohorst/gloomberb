export const PANE_SECTION = {
  assets: "Assets",
  data: "Data",
  portfolio: "Portfolio",
  workspace: "Workspace",
} as const;

export type PaneSection = (typeof PANE_SECTION)[keyof typeof PANE_SECTION];

/** Plugin-owned panes share one command-bar / help section instead of a plugin-name group. */
const PLUGIN_PANE_SECTIONS: Record<string, PaneSection> = {
  "ticker-research": PANE_SECTION.assets,
  "market-overview": PANE_SECTION.assets,
  yahoo: PANE_SECTION.assets,

  adjacent: PANE_SECTION.data,
  macro: PANE_SECTION.data,
  "prediction-markets": PANE_SECTION.data,
  news: PANE_SECTION.data,
  "congress-trades": PANE_SECTION.data,
  substack: PANE_SECTION.data,
  buildout: PANE_SECTION.data,
  usaspending: PANE_SECTION.data,
  opensky: PANE_SECTION.data,
  "nasa-firms": PANE_SECTION.data,
  "usgs-earthquakes": PANE_SECTION.data,
  "space-weather": PANE_SECTION.data,
  "federal-register": PANE_SECTION.data,
  "ofac-sanctions": PANE_SECTION.data,
  "crt-sh": PANE_SECTION.data,

  portfolio: PANE_SECTION.portfolio,
  broker: PANE_SECTION.portfolio,
  ibkr: PANE_SECTION.portfolio,

  application: PANE_SECTION.workspace,
  "gloomberb-cloud": PANE_SECTION.workspace,
  ai: PANE_SECTION.workspace,
  notes: PANE_SECTION.workspace,
  alerts: PANE_SECTION.workspace,
  "plugin-discovery": PANE_SECTION.workspace,
  "plugin-market": PANE_SECTION.workspace,
  debug: PANE_SECTION.workspace,
};

/** Overrides for templates whose plugin bucket would put them in the wrong half. */
const TEMPLATE_PANE_SECTIONS: Record<string, PaneSection> = {
  "data-catalog-pane": PANE_SECTION.data,
  "twitter-feed-pane": PANE_SECTION.data,
};

export function resolvePaneTemplateSection(options: {
  templateId?: string;
  templateCategory?: string;
  pluginId?: string | null;
}): string {
  const explicit = options.templateCategory?.trim();
  if (explicit) return explicit;
  if (options.templateId) {
    const templateSection = TEMPLATE_PANE_SECTIONS[options.templateId];
    if (templateSection) return templateSection;
  }
  if (options.pluginId) {
    const pluginSection = PLUGIN_PANE_SECTIONS[options.pluginId];
    if (pluginSection) return pluginSection;
  }
  return PANE_SECTION.workspace;
}
