import { createDesktopWindowBridge } from "./desktop/window/bridge";
import { isHostedWebClient } from "../../../shared/hosted-api";

export function createWebWindowBridge(kind: "main" | "detached", paneId?: string) {
  const bridge = createDesktopWindowBridge(kind, paneId);
  return {
    ...bridge,
    // Hosted windows have no desktop process to synchronize with.
    syncMainState: isHostedWebClient() ? undefined : bridge.syncMainState,
    syncThemePreview: isHostedWebClient() ? undefined : bridge.syncThemePreview,
    popOutPane: async (targetPaneId: string) => {
      const targetUrl = `/?kind=detached&paneId=${encodeURIComponent(targetPaneId)}`;
      const popup = window.open("about:blank", `gloomberb-pane-${targetPaneId}`, "popup,width=960,height=680");
      await bridge.popOutPane?.(targetPaneId);
      if (popup) popup.location.href = targetUrl;
    },
    focusDetachedPane: async (targetPaneId: string) => {
      window.open(`/?kind=detached&paneId=${encodeURIComponent(targetPaneId)}`, `gloomberb-pane-${targetPaneId}`);
    },
  };
}
