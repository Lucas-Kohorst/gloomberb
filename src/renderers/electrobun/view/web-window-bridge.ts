import { createDesktopWindowBridge } from "./desktop/window/bridge";

export function createWebWindowBridge(kind: "main" | "detached", paneId?: string) {
  const bridge = createDesktopWindowBridge(kind, paneId);
  return {
    ...bridge,
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
