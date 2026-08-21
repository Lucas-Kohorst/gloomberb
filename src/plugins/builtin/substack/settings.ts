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
import { getCachedSubstackHome } from "./api/cache";
import { tabIdForPublication } from "./table";
import {
  SUBSTACK_FEED_TAB_ID,
  type SubstackSortColumnId,
} from "./types";

export const SUBSTACK_COLUMN_IDS: readonly SubstackSortColumnId[] = [
  "published",
  "publication",
  "title",
  "read",
];
export const SUBSTACK_COLUMN_DEFS = [
  { id: "published", label: "Published", description: "When the post went out." },
  { id: "publication", label: "Publication", description: "Newsletter name. Hidden on a single-publication tab." },
  { id: "title", label: "Title", description: "Post title. Always kept visible." },
  { id: "read", label: "Read", description: "Estimated read time." },
] as const;
const DEFAULT_SORT = { columnId: "published" as const, direction: "desc" as const };

export function getSubstackPaneSettings(settings: Record<string, unknown> | undefined): {
  defaultTab: string;
  columnIds: SubstackSortColumnId[];
  sort: { columnId: SubstackSortColumnId; direction: "asc" | "desc" };
} {
  const columnIds = resolveVisibleColumns(
    SUBSTACK_COLUMN_DEFS,
    settings?.columnIds,
    SUBSTACK_COLUMN_IDS,
  ).map((column) => column.id as SubstackSortColumnId);
  if (!columnIds.includes("title")) columnIds.push("title");
  const defaultTab = typeof settings?.defaultTab === "string" && settings.defaultTab.trim()
    ? settings.defaultTab
    : SUBSTACK_FEED_TAB_ID;
  return {
    defaultTab,
    columnIds: columnIds.length > 0 ? columnIds : [...SUBSTACK_COLUMN_IDS],
    sort: parseSortPreference(settings?.sort, SUBSTACK_COLUMN_IDS, DEFAULT_SORT),
  };
}

export function buildSubstackPaneSettingsDef(
  settings: Record<string, unknown> | undefined,
): PaneSettingsDef {
  const resolved = getSubstackPaneSettings(settings);
  const publications = getCachedSubstackHome()?.subscriptions ?? [];
  const tabOptions = [
    { value: SUBSTACK_FEED_TAB_ID, label: "Inbox" },
    ...publications.map((publication) => ({
      value: tabIdForPublication(publication),
      label: publication.name,
    })),
  ];
  if (!tabOptions.some((option) => option.value === resolved.defaultTab)) {
    tabOptions.push({ value: resolved.defaultTab, label: "Current tab" });
  }
  return {
    title: "Substack Settings",
    values: {
      defaultTab: resolved.defaultTab,
      columnIds: [...resolved.columnIds],
      sort: encodeSortPreference(resolved.sort),
    },
    fields: [
      {
        key: "defaultTab",
        label: "Default tab",
        description: "Inbox or a subscribed publication.",
        type: "select",
        options: tabOptions,
      },
      buildColumnVisibilityField([...SUBSTACK_COLUMN_DEFS]),
      buildSortSelectField([
        { value: "published:desc", label: "Newest first" },
        { value: "published:asc", label: "Oldest first" },
        { value: "publication:asc", label: "Publication A–Z" },
        { value: "title:asc", label: "Title A–Z" },
        { value: "read:desc", label: "Longest first" },
      ]),
    ],
  };
}
