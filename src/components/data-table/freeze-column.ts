import { t } from "../../i18n";
import type { PaneSettingField, PaneSettingsDef } from "../../types/plugin";

/**
 * Pane setting key that controls the sticky first column on the DOM renderers.
 * The terminal renderer has no horizontal scrolling, so it never reads it.
 */
export const FREEZE_FIRST_COLUMN_SETTING_KEY = "freezeFirstColumn";

/**
 * Default on: a frozen column is inert while a table fits its pane, and only
 * the DOM renderers scroll tables sideways, so the toggle only needs an
 * explicit opt-out. Anything but an explicit `false` keeps the freeze active.
 */
export function resolveFreezeFirstColumnSetting(
  settings: Record<string, unknown> | undefined,
): boolean {
  return settings?.[FREEZE_FIRST_COLUMN_SETTING_KEY] !== false;
}

/**
 * The first column of the resolved column list freezes. Users reorder columns
 * through `columnIds` and pane width persistence reorders nothing, so the
 * frozen column follows the visible order, not the pane default.
 */
export function frozenTableColumnId(
  columns: readonly { id: string }[],
): string | null {
  return columns[0]?.id ?? null;
}

export const FREEZE_FIRST_COLUMN_SETTING_FIELD: PaneSettingField = {
  type: "toggle",
  key: FREEZE_FIRST_COLUMN_SETTING_KEY,
  label: t("Freeze first column"),
  description: t("Keep the first column pinned while the rest of the table scrolls sideways."),
};

/**
 * Adds the freeze toggle to a pane settings def. Mirrors the live-streaming
 * setting: `values` displays the default-on state, while the persisted setting
 * only stores an explicit opt-out.
 */
export function withFreezeFirstColumnSetting(
  settingsDef: PaneSettingsDef,
  settings: Record<string, unknown> | undefined,
): PaneSettingsDef {
  return {
    ...settingsDef,
    values: {
      ...settingsDef.values,
      [FREEZE_FIRST_COLUMN_SETTING_KEY]: resolveFreezeFirstColumnSetting(settings),
    },
    fields: [
      ...settingsDef.fields.filter((field) => field.key !== FREEZE_FIRST_COLUMN_SETTING_KEY),
      FREEZE_FIRST_COLUMN_SETTING_FIELD,
    ],
  };
}
