import { useCallback, useMemo, useRef, useState } from "react";
import { syncConfigActiveLayoutState } from "../../core/state/app/layout";
import { deletePaneSetting, setPaneSetting } from "../../pane-settings";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import {
  useAppDispatch,
  useAppSelector,
  useAppStateRef,
  useOptionalPaneInstanceId,
} from "../../state/app/context";
import { findPaneInstance } from "../../types/config";
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
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const stored = useAppSelector((state) => (
    paneId
      ? findPaneInstance(state.config.layout, paneId)?.settings?.[TABLE_COLUMN_WIDTHS_SETTING]
      : undefined
  ));
  const saved = useMemo(() => parseColumnWidths(stored), [stored]);
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
      ? setPaneSetting(currentState.config.layout, paneId, TABLE_COLUMN_WIDTHS_SETTING, nextValue)
      : deletePaneSetting(currentState.config.layout, paneId, TABLE_COLUMN_WIDTHS_SETTING);
    if (layout === currentState.config.layout) return;
    const nextConfig = syncConfigActiveLayoutState(
      { ...currentState.config, layout },
      currentState.paneState,
      currentState.focusedPaneId,
    );
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  }, [dispatch, paneId, stateRef]);

  const resizeColumn = useCallback((columnId: string, width: number) => {
    setDraft((current) => setColumnWidth(current ?? saved, columnId, width));
  }, [saved]);

  const persistWidths = useCallback(() => {
    const next = draftRef.current;
    if (next == null || !paneId) return;
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
