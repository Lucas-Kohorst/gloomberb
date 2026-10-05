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
import {
  combinePaneFooterRegistrations,
  samePaneFooterRegistration,
  selectPaneFooterHints,
  type CombinedPaneFooter,
  type PaneFooterRegistration,
  type PaneFooterSegment,
  type PaneHint,
} from "./model";
import { useAppLanguage } from "../../../../i18n/react";

const usePaneFooterRegistrationEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

const paneFooterRegistrations = new Map<string, Map<string, PaneFooterRegistration>>();

/** Returns the focused pane's current enabled footer hints without a second registry. */
export function readPaneFooterHints(paneId: string | null | undefined): PaneHint[] {
  if (!paneId) return [];
  const registrations = paneFooterRegistrations.get(paneId);
  return registrations ? selectPaneFooterHints(registrations) : [];
}

interface PaneFooterContextValue {
  register(registrationId: string, registration: PaneFooterRegistration | null): void;
  unregister(registrationId: string): void;
}

const PaneFooterContext = createContext<PaneFooterContextValue | null>(null);

/** Also gates non-footer interaction owned by an inactive pane/tab. */
export function usePaneFooterScopeActive(): boolean {
  return useContext(PaneFooterContext) !== null;
}

export function PaneFooterProvider({
  children,
  paneId,
}: {
  children: (footer: CombinedPaneFooter) => ReactNode;
  paneId?: string;
}) {
  const [registrations, setRegistrations] = useState<Map<string, PaneFooterRegistration>>(() => new Map());

  const register = useCallback((registrationId: string, registration: PaneFooterRegistration | null) => {
    setRegistrations((current) => {
      const hasContent = !!registration && (
        (registration.info?.length ?? 0) > 0
        || (registration.trailingInfo?.length ?? 0) > 0
        || (registration.hints?.length ?? 0) > 0
      );
      const previous = current.get(registrationId) ?? null;
      const nextRegistration = hasContent ? registration : null;
      if (samePaneFooterRegistration(previous, nextRegistration)) return current;
      const next = new Map(current);
      if (nextRegistration) next.set(registrationId, nextRegistration);
      else next.delete(registrationId);
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
  const footer = useMemo(() => combinePaneFooterRegistrations(registrations), [registrations]);

  useEffect(() => {
    if (!paneId) return;
    paneFooterRegistrations.set(paneId, registrations);
    return () => {
      if (paneFooterRegistrations.get(paneId) === registrations) {
        paneFooterRegistrations.delete(paneId);
      }
    };
  }, [paneId, registrations]);

  return (
    <PaneFooterContext.Provider value={value}>
      {children(footer)}
    </PaneFooterContext.Provider>
  );
}

export function PaneFooterScope({
  active,
  children,
  onHintsChange,
}: {
  active: boolean;
  children: ReactNode;
  /** Reports the scope's enabled hints so a parent can avoid binding the same keys. */
  onHintsChange?: (hints: readonly PaneHint[]) => void;
}) {
  const parentContext = useContext(PaneFooterContext);
  const context = active ? parentContext : null;
  const onHintsChangeRef = useRef(onHintsChange);
  onHintsChangeRef.current = onHintsChange;
  const observed = !!onHintsChange;
  const value = useMemo<PaneFooterContextValue | null>(() => {
    if (!context || !observed) return context;
    const hintsById = new Map<string, PaneHint[]>();
    const emit = () => {
      onHintsChangeRef.current?.([...hintsById.values()].flat().filter((hint) => !hint.disabled));
    };
    return {
      register(registrationId, registration) {
        context.register(registrationId, registration);
        if (registration?.hints?.length) hintsById.set(registrationId, registration.hints);
        else hintsById.delete(registrationId);
        emit();
      },
      unregister(registrationId) {
        context.unregister(registrationId);
        if (hintsById.delete(registrationId)) emit();
      },
    };
  }, [context, observed]);
  return (
    <PaneFooterContext.Provider value={value}>
      {children}
    </PaneFooterContext.Provider>
  );
}

export function usePaneFooter(
  registrationId: string,
  factory: () => PaneFooterRegistration | null | undefined,
  deps: DependencyList,
) {
  const language = useAppLanguage();
  const context = useContext(PaneFooterContext);
  const previousRegistrationRef = useRef<PaneFooterRegistration | null>(null);
  const latestRegistrationRef = useRef<PaneFooterRegistration | null>(null);

  usePaneFooterRegistrationEffect(() => {
    return () => {
      previousRegistrationRef.current = null;
      latestRegistrationRef.current = null;
      context?.unregister(registrationId);
    };
  }, [context, registrationId]);

  usePaneFooterRegistrationEffect(() => {
    if (!context) return;
    const nextRegistration = factory() ?? null;
    latestRegistrationRef.current = nextRegistration;
    if (samePaneFooterRegistration(previousRegistrationRef.current, nextRegistration)) return;
    previousRegistrationRef.current = nextRegistration;
    if (!nextRegistration) {
      context.register(registrationId, null);
      return;
    }
    // Keep visual registrations stable while pointer/remote actions follow the
    // current item. Comparing handler identities instead would loop for inline callbacks.
    const bindSegments = (key: "info" | "trailingInfo"): PaneFooterSegment[] | undefined => (
      nextRegistration[key]?.map((segment) => {
        const current = () => latestRegistrationRef.current?.[key]?.find((entry) => entry.id === segment.id);
        return {
          ...segment,
          onPress: segment.onPress ? () => {
            const next = current();
            if (!next?.disabled) next?.onPress?.();
          } : undefined,
          menu: segment.menu ? {
            ...segment.menu,
            onSelect: (value) => {
              const next = current();
              if (!next?.disabled) next?.menu?.onSelect(value);
            },
          } : undefined,
        };
      })
    );
    context.register(registrationId, {
      ...nextRegistration,
      info: bindSegments("info"),
      trailingInfo: bindSegments("trailingInfo"),
      hints: nextRegistration.hints?.map((hint) => ({
        ...hint,
        onPress: hint.onPress ? (event) => {
          const current = latestRegistrationRef.current?.hints?.find((entry) => entry.id === hint.id);
          if (!current?.disabled) current?.onPress?.(event);
        } : undefined,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, language, registrationId, ...deps]);
}

export function usePaneHints(
  registrationId: string,
  factory: () => PaneHint[] | null | undefined,
  deps: DependencyList,
) {
  usePaneFooter(registrationId, () => {
    const hints = factory();
    return hints && hints.length > 0 ? { hints } : null;
  }, deps);
}
