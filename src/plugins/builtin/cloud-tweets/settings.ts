import {
  buildColumnVisibilityField,
  resolveVisibleColumns,
} from "../../../components/data-table/column-settings";
import {
  buildSortSelectField,
  encodeSortPreference,
  parseSortPreference,
} from "../../../components/data-table/sort-settings";
import type { PaneSettingsDef } from "../../../types/plugin";
import {
  DEFAULT_TWEET_SORT,
  TWEET_COLUMN_DEFS,
  TWEET_COLUMN_IDS,
  TWEET_SORT_COLUMN_IDS,
  type TweetColumnId,
  type TweetDensity,
} from "./model";

export function getTwitterFeedPaneSettings(settings: Record<string, unknown> | undefined): {
  columnIds: TweetColumnId[];
  sort: typeof DEFAULT_TWEET_SORT;
  density: TweetDensity;
} {
  const columnIds = resolveVisibleColumns(
    TWEET_COLUMN_DEFS,
    settings?.columnIds,
    TWEET_COLUMN_IDS,
  ).map((column) => column.id as TweetColumnId);
  return {
    columnIds: columnIds.length > 0 ? columnIds : [...TWEET_COLUMN_IDS],
    sort: parseSortPreference(settings?.sort, TWEET_SORT_COLUMN_IDS, DEFAULT_TWEET_SORT),
    density: settings?.density === "compact" ? "compact" : "comfortable",
  };
}

export function buildTwitterFeedPaneSettingsDef(
  settings: Record<string, unknown> | undefined,
): PaneSettingsDef {
  const resolved = getTwitterFeedPaneSettings(settings);
  return {
    title: "X Feed Settings",
    values: {
      columnIds: [...resolved.columnIds],
      sort: encodeSortPreference(resolved.sort),
      density: resolved.density,
    },
    fields: [
      {
        key: "density",
        label: "Density",
        description: "Compact uses a single line per tweet. Comfortable wraps tweet text.",
        type: "select",
        options: [
          { value: "comfortable", label: "Comfortable", description: "Wrap tweet text across multiple rows." },
          { value: "compact", label: "Compact", description: "One row per tweet." },
        ],
      },
      buildColumnVisibilityField(TWEET_COLUMN_DEFS),
      buildSortSelectField([
        { value: "time:desc", label: "Newest first" },
        { value: "time:asc", label: "Oldest first" },
        { value: "likes:desc", label: "Most likes" },
        { value: "views:desc", label: "Most views" },
      ]),
    ],
  };
}
