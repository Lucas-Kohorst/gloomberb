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
      onError(error);
    }
  };
  const autosave = () => {
    save();
  };
  widget.subscribe?.("onAutoSaveNeeded", autosave);
  return () => {
    try {
      widget.unsubscribe?.("onAutoSaveNeeded", autosave);
    } catch {
      return;
    }
    save();
  };
}
