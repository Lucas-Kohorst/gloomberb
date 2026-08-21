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
import { DEFAULT_POLL_SORT, type PollSortColumnId, type PollSortPreference } from "./normalize";
import type { PollTabId } from "./types";

export type PollColumnId = "date" | "subject" | "pollster" | "pop" | "result";

export const POLL_COLUMN_IDS: readonly PollColumnId[] = ["date", "subject", "pollster", "pop", "result"];
export const POLL_COLUMN_DEFS = [
  { id: "date", label: "DATE", description: "Poll end date." },
  { id: "subject", label: "SUBJECT", description: "Race or question." },
  { id: "pollster", label: "POLLSTER", description: "Polling firm." },
  { id: "pop", label: "POP", description: "Sample population." },
  { id: "result", label: "RESULT", description: "Headline result." },
] as const;

const POLL_TABS: Array<{ value: PollTabId; label: string }> = [
  { value: "all", label: "All" },
  { value: "approval", label: "Approval" },
  { value: "favorability", label: "Favorability" },
  { value: "generic-ballot", label: "Generic" },
  { value: "us-senator", label: "Senate" },
  { value: "governor", label: "Governor" },
  { value: "us-representative", label: "House" },
];

const POLL_TAB_IDS = POLL_TABS.map((tab) => tab.value);
const POLL_SORT_COLUMNS: readonly PollSortColumnId[] = POLL_COLUMN_IDS;

export function isPollTabId(value: unknown): value is PollTabId {
  return typeof value === "string" && POLL_TAB_IDS.includes(value as PollTabId);
}

export function getPollsPaneSettings(settings: Record<string, unknown> | undefined): {
  defaultTab: PollTabId;
  columnIds: PollColumnId[];
  sort: PollSortPreference;
} {
  const columnIds = resolveVisibleColumns(
    POLL_COLUMN_DEFS,
    settings?.columnIds,
    POLL_COLUMN_IDS,
  ).map((column) => column.id as PollColumnId);
  return {
    defaultTab: isPollTabId(settings?.defaultTab) ? settings.defaultTab : "all",
    columnIds: columnIds.length > 0 ? columnIds : [...POLL_COLUMN_IDS],
    sort: parseSortPreference(settings?.sort, POLL_SORT_COLUMNS, DEFAULT_POLL_SORT),
  };
}

export function buildPollsPaneSettingsDef(
  settings: Record<string, unknown> | undefined,
): PaneSettingsDef {
  const resolved = getPollsPaneSettings(settings);
  return {
    title: "Polls Settings",
    values: {
      defaultTab: resolved.defaultTab,
      columnIds: [...resolved.columnIds],
      sort: encodeSortPreference(resolved.sort),
    },
    fields: [
      {
        key: "defaultTab",
        label: "Default tab",
        description: "Race type shown when this pane opens.",
        type: "select",
        options: POLL_TABS,
      },
      buildColumnVisibilityField([...POLL_COLUMN_DEFS]),
      buildSortSelectField([
        { value: "date:desc", label: "Newest first" },
        { value: "date:asc", label: "Oldest first" },
        { value: "subject:asc", label: "Subject A–Z" },
        { value: "pollster:asc", label: "Pollster A–Z" },
        { value: "result:desc", label: "Largest lead" },
      ]),
    ],
  };
}
