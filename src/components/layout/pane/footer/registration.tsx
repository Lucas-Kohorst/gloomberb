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
}: {
  active: boolean;
  children: ReactNode;
}) {
  const context = useContext(PaneFooterContext);
  return (
    <PaneFooterContext.Provider value={active ? context : null}>
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

  usePaneFooterRegistrationEffect(() => {
    return () => {
      previousRegistrationRef.current = null;
      context?.unregister(registrationId);
    };
  }, [context, registrationId]);

  usePaneFooterRegistrationEffect(() => {
    if (!context) return;
    const nextRegistration = factory() ?? null;
    if (samePaneFooterRegistration(previousRegistrationRef.current, nextRegistration)) return;
    previousRegistrationRef.current = nextRegistration;
    context.register(registrationId, nextRegistration);
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
