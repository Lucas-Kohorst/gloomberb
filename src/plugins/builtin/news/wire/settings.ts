import {
  buildColumnVisibilityField,
  resolveVisibleColumns,
} from "../../../../components/data-table/column-settings";
import {
  buildSortSelectField,
  encodeSortPreference,
  parseSortPreference,
} from "../../../../components/data-table/sort-settings";
import type { PaneSettingsContext, PaneSettingsDef } from "../../../../types/plugin";
import type { ColumnVisibilityColumn } from "../../../../components/data-table/column-settings";
import type { NewsColumnId, NewsSortPreference } from "./news/table";
import { cachedNewsArticles } from "./article-search";
import {
  NEWS_MUTED_KEYWORDS_KEY,
  NEWS_MUTED_SOURCES_KEY,
  NEWS_PLUGIN_ID,
  collectNewsSourceOptions,
  readNewsMutesFromPluginConfig,
} from "./mutes";

export const NEWS_COLUMN_IDS: readonly NewsColumnId[] = [
  "rank",
  "time",
  "origin",
  "source",
  "title",
  "tickers",
  "categories",
  "importance",
];

export const NEWS_COLUMN_DEFS: readonly ColumnVisibilityColumn[] = [
  { id: "rank", label: "#", description: "Position in the current sort." },
  { id: "time", label: "Time", description: "When the story was published." },
  { id: "origin", label: "Origin", description: "Which news integration produced the story." },
  { id: "source", label: "Source", description: "Publisher or feed name." },
  { id: "title", label: "Headline", description: "Story title. Always kept visible." },
  { id: "tickers", label: "Tickers", description: "Mentioned symbols." },
  { id: "categories", label: "Category", description: "Topic or category labels." },
  { id: "importance", label: "Score", description: "Ranked importance." },
];
import {
  SECTOR_NEWS_SECTORS,
  sectorNewsLabel,
  type SectorNewsSelection,
} from "./news/query-presets";

export const NEWS_SORT_OPTIONS = [
  { value: "time:desc", label: "Newest first", description: "Latest stories at the top." },
  { value: "time:asc", label: "Oldest first" },
  { value: "importance:desc", label: "Highest score" },
  { value: "importance:asc", label: "Lowest score" },
  { value: "title:asc", label: "Headline A–Z" },
  { value: "source:asc", label: "Source A–Z" },
  { value: "origin:asc", label: "Origin A–Z" },
] as const;

const SECTOR_TABS: readonly SectorNewsSelection[] = ["all", ...SECTOR_NEWS_SECTORS];

export interface NewsPaneSettings {
  columnIds: NewsColumnId[];
  sort: NewsSortPreference;
}

export function isNewsColumnId(value: string): value is NewsColumnId {
  return NEWS_COLUMN_IDS.includes(value as NewsColumnId);
}

function coerceColumnIds(value: unknown, fallback: readonly NewsColumnId[]): NewsColumnId[] {
  const resolved = resolveVisibleColumns(
    NEWS_COLUMN_DEFS,
    value,
    fallback,
  ).map((column) => column.id).filter(isNewsColumnId);
  if (!resolved.includes("title")) resolved.push("title");
  return resolved.length > 0 ? resolved : [...fallback];
}

export function getNewsPaneSettings(
  settings: Record<string, unknown> | undefined,
  fallback: { columns: readonly NewsColumnId[]; sort: NewsSortPreference },
): NewsPaneSettings {
  return {
    columnIds: coerceColumnIds(settings?.columnIds, fallback.columns),
    sort: parseSortPreference(settings?.sort, NEWS_COLUMN_IDS, fallback.sort),
  };
}

export function getIndustryDefaultTab(
  settings: Record<string, unknown> | undefined,
): SectorNewsSelection {
  const value = settings?.defaultTab;
  if (value === "all" || (typeof value === "string" && SECTOR_NEWS_SECTORS.includes(value as typeof SECTOR_NEWS_SECTORS[number]))) {
    return value as SectorNewsSelection;
  }
  return "all";
}

export type RssViewMode = "articles" | "feeds";

export function getRssViewMode(settings: Record<string, unknown> | undefined): RssViewMode {
  return settings?.defaultTab === "feeds" ? "feeds" : "articles";
}

export function buildRssPaneSettingsDef(
  context: PaneSettingsContext,
): PaneSettingsDef {
  const fallbackColumns: NewsColumnId[] = ["time", "source", "title", "categories"];
  const fallbackSort: NewsSortPreference = { columnId: "time", direction: "desc" };
  const base = buildNewsPaneSettingsDef(context, { columns: fallbackColumns, sort: fallbackSort }, {
    title: "RSS Settings",
    includeMutes: true,
  });
  return {
    ...base,
    values: {
      ...base.values,
      defaultTab: getRssViewMode(context.settings),
    },
    fields: [
      {
        key: "defaultTab",
        label: "Default tab",
        description: "Open the article list or the feed manager.",
        type: "select",
        options: [
          { value: "articles", label: "Articles" },
          { value: "feeds", label: "Feeds" },
        ],
      },
      ...base.fields,
    ],
  };
}

export function buildNewsPaneSettingsDef(
  context: PaneSettingsContext,
  fallback: { columns: readonly NewsColumnId[]; sort: NewsSortPreference },
  extras?: {
    title?: string;
    includeDefaultTab?: boolean;
    /** Add the global Muted Sources / Muted Keywords fields (feed-list panes only). */
    includeMutes?: boolean;
  },
): PaneSettingsDef {
  const settings = context.settings;
  const resolved = getNewsPaneSettings(settings, fallback);
  const fields: PaneSettingsDef["fields"] = [
    buildColumnVisibilityField(NEWS_COLUMN_DEFS.filter((column) => fallback.columns.includes(column.id as NewsColumnId))),
    buildSortSelectField(
      NEWS_SORT_OPTIONS.filter((option) => fallback.columns.includes(option.value.split(":")[0] as NewsColumnId)),
    ),
  ];
  if (extras?.includeDefaultTab) {
    fields.unshift({
      key: "defaultTab",
      label: "Default tab",
      description: "Sector to show when this pane opens.",
      type: "select",
      options: SECTOR_TABS.map((tab) => ({
        value: tab,
        label: sectorNewsLabel(tab),
      })),
    });
  }
  if (extras?.includeMutes) {
    const currentMutes = readNewsMutesFromPluginConfig(
      context.config.pluginConfig[NEWS_PLUGIN_ID],
    );
    fields.push(
      {
        key: NEWS_MUTED_SOURCES_KEY,
        label: "Muted Sources",
        description: "Hide stories from these publishers in feed lists. Top News and Breaking News still show them.",
        type: "multi-select",
        storage: "plugin",
        options: collectNewsSourceOptions(cachedNewsArticles(), currentMutes.sources),
      },
      {
        key: NEWS_MUTED_KEYWORDS_KEY,
        label: "Muted Keywords",
        description: "Hide feed-list stories whose headline contains any of these comma-separated keywords.",
        type: "text",
        storage: "plugin",
        placeholder: "crypto, earnings call, giveaway",
      },
    );
  }
  return {
    title: extras?.title ?? "News Settings",
    values: {
      columnIds: [...resolved.columnIds],
      sort: encodeSortPreference(resolved.sort),
      ...(extras?.includeDefaultTab ? { defaultTab: getIndustryDefaultTab(settings) } : {}),
    },
    fields,
  };
}
