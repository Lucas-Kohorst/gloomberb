import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface PaneBodyLoadingApi {
  signal(id: string, active: boolean): void;
  cover(id: string, active: boolean): void;
}

const PaneBodyLoadingApiContext = createContext<PaneBodyLoadingApi | null>(null);
const PaneBodySpinnerContext = createContext(false);

function setMember(current: ReadonlySet<string>, id: string, active: boolean): ReadonlySet<string> {
  if (current.has(id) === active) return current;
  const next = new Set(current);
  if (active) next.add(id);
  else next.delete(id);
  return next;
}

/** Claims for "something is in flight" and "the body already shows the spinner". */
export function PaneBodyLoadingProvider({ children }: { children: ReactNode }) {
  const [signals, setSignals] = useState<ReadonlySet<string>>(() => new Set());
  const [covers, setCovers] = useState<ReadonlySet<string>>(() => new Set());
  const signal = useCallback((id: string, active: boolean) => {
    setSignals((current) => setMember(current, id, active));
  }, []);
  const cover = useCallback((id: string, active: boolean) => {
    setCovers((current) => setMember(current, id, active));
  }, []);
  const api = useMemo(() => ({ signal, cover }), [signal, cover]);
  const show = signals.size > 0 && covers.size === 0;
  return (
    <PaneBodyLoadingApiContext.Provider value={api}>
      <PaneBodySpinnerContext.Provider value={show}>{children}</PaneBodySpinnerContext.Provider>
    </PaneBodyLoadingApiContext.Provider>
  );
}

export function usePaneBodyLoadingApi(): PaneBodyLoadingApi | null {
  return useContext(PaneBodyLoadingApiContext);
}

/** True when a load is in flight and the body is not already a full spinner. */
export function usePaneBodySpinner(): boolean {
  return useContext(PaneBodySpinnerContext);
}
