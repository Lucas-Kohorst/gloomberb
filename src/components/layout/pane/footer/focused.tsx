import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useUiCapabilities } from "../../../../ui";
import {
  EMPTY_FOOTER,
  hasPaneFooterContent,
  samePaneFooterRegistration,
  type CombinedPaneFooter,
} from "./model";

interface FocusedPaneFooterContextValue {
  footer: CombinedPaneFooter | null;
  setFooter(paneId: string, footer: CombinedPaneFooter | null): void;
}

const FocusedPaneFooterContext = createContext<FocusedPaneFooterContextValue | null>(null);

/** Hosted/desktop window status bar reads the focused pane's footer from here. */
export function FocusedPaneFooterHost({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ paneId: string; footer: CombinedPaneFooter } | null>(null);

  const setFooter = useCallback((paneId: string, footer: CombinedPaneFooter | null) => {
    setEntry((current) => {
      if (!footer || !hasPaneFooterContent(footer)) {
        return current?.paneId === paneId ? null : current;
      }
      if (current?.paneId === paneId && samePaneFooterRegistration(current.footer, footer)) {
        return current;
      }
      return { paneId, footer };
    });
  }, []);

  const value = useMemo<FocusedPaneFooterContextValue>(
    () => ({ footer: entry?.footer ?? null, setFooter }),
    [entry, setFooter],
  );

  return (
    <FocusedPaneFooterContext.Provider value={value}>
      {children}
    </FocusedPaneFooterContext.Provider>
  );
}

export function useFocusedPaneFooter(): CombinedPaneFooter | null {
  return useContext(FocusedPaneFooterContext)?.footer ?? null;
}

function usePromotePaneFooterToStatusBar(): boolean {
  const host = useContext(FocusedPaneFooterContext);
  const { nativePaneChrome } = useUiCapabilities();
  return !!nativePaneChrome && host != null;
}

/** Publish the focused pane footer to the window status bar; hide the in-pane copy on web/desktop. */
export function usePaneFooterPlacement(
  paneId: string | undefined,
  focused: boolean,
  footer: CombinedPaneFooter | null | undefined,
): { hideInPane: boolean } {
  const host = useContext(FocusedPaneFooterContext);
  const hideInPane = usePromotePaneFooterToStatusBar();
  const resolved = footer && hasPaneFooterContent(footer) ? footer : EMPTY_FOOTER;

  useLayoutEffect(() => {
    if (!host || !paneId || !hideInPane) return;
    if (focused) host.setFooter(paneId, resolved);
    return () => {
      host.setFooter(paneId, null);
    };
  }, [focused, hideInPane, host, paneId, resolved]);

  return { hideInPane };
}
