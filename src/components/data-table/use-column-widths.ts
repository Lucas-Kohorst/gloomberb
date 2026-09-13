import { useCallback, useMemo, useRef, useState } from "react";
import { deletePaneSetting, setPaneSetting } from "../../pane-settings";
import { syncConfigActiveLayoutState } from "../../core/state/app/state";
import { findPaneInstance } from "../../types/config";
import {
  useAppDispatch,
  useAppStateRef,
  useOptionalPaneInstanceId,
  usePaneInstance,
} from "../../state/app/context";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import {
  applyColumnWidths,
  columnWidthsWithout,
  hasColumnWidths,
  parseColumnWidths,
  setColumnWidth,
  TABLE_COLUMN_WIDTHS_SETTING,
  type TableColumnWidths,
  type WidthLockableColumn,
} from "./column-widths";

export function useTableColumnWidths<C extends WidthLockableColumn>(
  columns: readonly C[],
): {
  columns: C[];
  resizeColumn: (columnId: string, width: number) => void;
  persistWidths: () => void;
  resetColumn: (columnId: string) => void;
} {
  const paneId = useOptionalPaneInstanceId();
  const instance = usePaneInstance();
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const saved = useMemo(
    () => parseColumnWidths(instance?.settings?.[TABLE_COLUMN_WIDTHS_SETTING]),
    [instance?.settings],
  );
  const [draft, setDraft] = useState<TableColumnWidths | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const widths = draft ?? saved;

  const persist = useCallback((nextWidths: TableColumnWidths) => {
    if (!paneId) return;
    const currentState = stateRef.current;
    const current = findPaneInstance(currentState.config.layout, paneId);
    const currentSaved = parseColumnWidths(current?.settings?.[TABLE_COLUMN_WIDTHS_SETTING]);
    const nextValue = hasColumnWidths(nextWidths) ? nextWidths : undefined;
    const currentValue = hasColumnWidths(currentSaved) ? currentSaved : undefined;
    if (columnWidthsEqual(currentValue, nextValue)) return;
    const layout = nextValue
      ? setPaneSetting(
        currentState.config.layout,
        paneId,
        TABLE_COLUMN_WIDTHS_SETTING,
        nextValue,
      )
      : deletePaneSetting(currentState.config.layout, paneId, TABLE_COLUMN_WIDTHS_SETTING);
    const nextConfig = syncConfigActiveLayoutState(
      { ...currentState.config, layout },
      currentState.paneState,
      currentState.focusedPaneId,
      currentState.activePanel,
    );
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  }, [dispatch, paneId, stateRef]);

  const resizeColumn = useCallback((columnId: string, width: number) => {
    setDraft((current) => setColumnWidth(current ?? saved, columnId, width));
  }, [saved]);

  const persistWidths = useCallback(() => {
    const next = draftRef.current;
    if (next == null) return;
    if (!paneId) return;
    persist(next);
    setDraft(null);
  }, [paneId, persist]);

  const resetColumn = useCallback((columnId: string) => {
    const next = columnWidthsWithout(draftRef.current ?? saved, columnId);
    if (!paneId) {
      setDraft(hasColumnWidths(next) ? next : {});
      return;
    }
    persist(next);
    setDraft(null);
  }, [paneId, persist, saved]);

  const displayColumns = useMemo(
    () => applyColumnWidths(columns, widths),
    [columns, widths],
  );

  return {
    columns: displayColumns,
    resizeColumn,
    persistWidths,
    resetColumn,
  };
}

function columnWidthsEqual(
  left: TableColumnWidths | undefined,
  right: TableColumnWidths | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left == null && right == null;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}
