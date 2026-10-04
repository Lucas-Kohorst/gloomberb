import { debugLog } from "../../../utils/debug-log";

export interface ChartLayoutStore {
  getConfigState<T>(pluginId: string, key: string): T | null;
  setConfigState(pluginId: string, key: string, value: unknown): Promise<void>;
}

export interface PersistableChartWidget {
  save?: (callback: (state: object) => void) => void;
  subscribe?: (event: "onAutoSaveNeeded", callback: () => void) => void;
  unsubscribe?: (event: "onAutoSaveNeeded", callback: () => void) => void;
}

const PLUGIN_ID = "chart-composer";
const log = debugLog.createLogger("chart-composer");

function isDeadChartWindow(error: unknown): boolean {
  return error instanceof TypeError
    && /doWhenApiIsReady|contentWindow|tradingViewApi/.test(error.message);
}

export function chartLayoutKey(symbol: string, compares: readonly string[]): string {
  return `advanced-layout:v1:${JSON.stringify([symbol, [...compares].sort()])}`;
}

export function readChartLayout(store: ChartLayoutStore | undefined, key: string): object | undefined {
  const saved = store?.getConfigState<unknown>(PLUGIN_ID, key);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : undefined;
}

export function persistChartLayout(
  widget: PersistableChartWidget,
  store: ChartLayoutStore | undefined,
  key: string,
  onError: (error: unknown) => void,
): () => void {
  if (!store || !widget.save) return () => {};
  let previous: string | undefined = JSON.stringify(readChartLayout(store, key));
  // Capture the mounted defaults so a loading chart does not save itself on teardown.
  try {
    widget.save((state) => { previous = JSON.stringify(state); });
  } catch (error) {
    onError(error);
  }
  const save = () => {
    try {
      widget.save?.((state) => {
        const serialized = JSON.stringify(state);
        if (serialized === previous) return;
        previous = serialized;
        void store.setConfigState(PLUGIN_ID, key, state).catch((error: unknown) => {
          if (previous === serialized) previous = undefined;
          onError(error);
        });
      });
    } catch (error) {
      if (isDeadChartWindow(error)) {
        log.warn("chart layout save skipped; chart window is gone", error);
        return;
      }
      onError(error);
    }
  };
  const autosave = () => {
    save();
  };
  widget.subscribe?.("onAutoSaveNeeded", autosave);
  return () => {
    save();
    try {
      widget.unsubscribe?.("onAutoSaveNeeded", autosave);
    } catch (error) {
      if (isDeadChartWindow(error)) {
        log.warn("chart layout unsubscribe skipped; chart window is gone", error);
        return;
      }
      onError(error);
    }
  };
}
