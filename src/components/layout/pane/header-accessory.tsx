import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import { Box } from "../../../ui";

const usePaneHeaderAccessoryEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface PaneHeaderAccessory {
  node: ReactNode;
  width: number;
}

interface PaneHeaderAccessoryContextValue {
  register(registrationId: string, accessory: PaneHeaderAccessory | null): void;
  unregister(registrationId: string): void;
}

const PaneHeaderAccessoryContext = createContext<PaneHeaderAccessoryContextValue | null>(null);

function samePaneHeaderAccessory(
  previous: PaneHeaderAccessory | null,
  next: PaneHeaderAccessory | null,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.node === next.node && previous.width === next.width;
}

function combinePaneHeaderAccessories(
  registrations: Map<string, PaneHeaderAccessory>,
): PaneHeaderAccessory | null {
  const entries = [...registrations.entries()];
  const only = entries[0];
  if (!only) return null;
  if (entries.length === 1) return only[1];
  return {
    width: entries.reduce((total, [, accessory]) => total + Math.max(0, accessory.width), 0),
    node: (
      <>
        {entries.map(([registrationId, accessory]) => (
          <Box key={registrationId} flexShrink={0} flexDirection="row">
            {accessory.node}
          </Box>
        ))}
      </>
    ),
  };
}

export function PaneHeaderAccessoryProvider({
  children,
}: {
  children: (accessory: PaneHeaderAccessory | null) => ReactNode;
}) {
  const [registrations, setRegistrations] = useState<Map<string, PaneHeaderAccessory>>(() => new Map());

  const register = useCallback((registrationId: string, accessory: PaneHeaderAccessory | null) => {
    setRegistrations((current) => {
      const next = new Map(current);
      if (accessory?.node != null) {
        next.set(registrationId, accessory);
      } else {
        next.delete(registrationId);
      }
      return next;
    });
  }, []);

  const unregister = useCallback((registrationId: string) => {
    setRegistrations((current) => {
      if (!current.has(registrationId)) return current;
      const next = new Map(current);
      next.delete(registrationId);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ register, unregister }), [register, unregister]);
  const accessory = useMemo(() => combinePaneHeaderAccessories(registrations), [registrations]);

  return (
    <PaneHeaderAccessoryContext.Provider value={value}>
      {children(accessory)}
    </PaneHeaderAccessoryContext.Provider>
  );
}

export function usePaneHeaderAccessory(
  registrationId: string,
  factory: () => PaneHeaderAccessory | null | undefined,
  deps: DependencyList,
) {
  const context = useContext(PaneHeaderAccessoryContext);
  const previousAccessoryRef = useRef<PaneHeaderAccessory | null>(null);

  usePaneHeaderAccessoryEffect(() => {
    return () => {
      previousAccessoryRef.current = null;
      context?.unregister(registrationId);
    };
  }, [context, registrationId]);

  usePaneHeaderAccessoryEffect(() => {
    if (!context) return;
    const nextAccessory = factory() ?? null;
    if (samePaneHeaderAccessory(previousAccessoryRef.current, nextAccessory)) return;
    previousAccessoryRef.current = nextAccessory;
    context.register(registrationId, nextAccessory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, registrationId, ...deps]);
}
