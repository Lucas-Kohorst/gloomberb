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

type SetFocusedPaneFooter = (paneId: string, footer: CombinedPaneFooter | null) => void;

const FocusedPaneFooterDispatchContext = createContext<SetFocusedPaneFooter | null>(null);
const FocusedPaneFooterStateContext = createContext<CombinedPaneFooter | null>(null);

/** Hosted/desktop window status bar reads the focused pane's footer from here. */
export function FocusedPaneFooterHost({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ paneId: string; footer: CombinedPaneFooter } | null>(null);

  const setFooter = useCallback<SetFocusedPaneFooter>((paneId, footer) => {
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

  return (
    <FocusedPaneFooterDispatchContext.Provider value={setFooter}>
      <FocusedPaneFooterStateContext.Provider value={entry?.footer ?? null}>
        {children}
      </FocusedPaneFooterStateContext.Provider>
    </FocusedPaneFooterDispatchContext.Provider>
  );
}

export function useFocusedPaneFooter(): CombinedPaneFooter | null {
  return useContext(FocusedPaneFooterStateContext);
}

function usePromotePaneFooterToStatusBar(): boolean {
  const setFooter = useContext(FocusedPaneFooterDispatchContext);
  const { nativePaneChrome } = useUiCapabilities();
  return !!nativePaneChrome && setFooter != null;
}

/** Publish the focused pane footer to the window status bar; hide the in-pane copy on web/desktop. */
export function usePaneFooterPlacement(
  paneId: string | undefined,
  focused: boolean,
  footer: CombinedPaneFooter | null | undefined,
): { hideInPane: boolean } {
  const setFooter = useContext(FocusedPaneFooterDispatchContext);
  const hideInPane = usePromotePaneFooterToStatusBar();
  const resolved = footer && hasPaneFooterContent(footer) ? footer : EMPTY_FOOTER;

  useLayoutEffect(() => {
    if (!setFooter || !paneId || !hideInPane) return;
    if (focused) setFooter(paneId, resolved);
    return () => {
      setFooter(paneId, null);
    };
  }, [focused, hideInPane, paneId, resolved, setFooter]);

  return { hideInPane };
}
