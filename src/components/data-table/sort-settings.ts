import type { PaneSettingField, PaneSettingOption } from "../../types/plugin";

export type SortDirection = "asc" | "desc";

export interface SortPreference<T extends string = string> {
  columnId: T;
  direction: SortDirection;
}

export function encodeSortPreference(preference: SortPreference): string {
  return `${preference.columnId}:${preference.direction}`;
}

export function parseSortPreference<T extends string>(
  value: unknown,
  allowedColumnIds: readonly T[],
  fallback: SortPreference<T>,
): SortPreference<T> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { columnId?: unknown; direction?: unknown };
    if (typeof candidate.columnId === "string" && allowedColumnIds.includes(candidate.columnId as T)) {
      return {
        columnId: candidate.columnId as T,
        direction: candidate.direction === "asc" ? "asc" : "desc",
      };
    }
  }
  if (typeof value === "string") {
    const separator = value.lastIndexOf(":");
    const columnId = separator >= 0 ? value.slice(0, separator) : value;
    const direction = separator >= 0 ? value.slice(separator + 1) : "";
    if (allowedColumnIds.includes(columnId as T)) {
      return {
        columnId: columnId as T,
        direction: direction === "asc" ? "asc" : "desc",
      };
    }
  }
  return fallback;
}

export function buildSortSelectField(
  options: readonly (PaneSettingOption & { value: string })[],
  extras?: { key?: string; label?: string; description?: string },
): PaneSettingField {
  return {
    key: extras?.key ?? "sort",
    label: extras?.label ?? "Default sort",
    description: extras?.description,
    type: "select",
    options: [...options],
  };
}
