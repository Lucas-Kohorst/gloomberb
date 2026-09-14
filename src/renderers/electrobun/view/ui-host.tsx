/** @jsxImportSource react */
import type { RendererHost, UiHost } from "../../../ui/host";
import { backendRequest } from "./backend-rpc";
import {
  NATIVE_CONTEXT_MENU_SUPPORTED,
  showDesktopContextMenu,
  startElectrobunWindowDrag,
} from "./host/native";
import { createDomUiHost } from "./dom-ui-host";

export function createWebUiHost(
  desktopPlatform?: string,
  options: {
    nativeContextMenu?: boolean;
    nativeWindowChrome?: boolean;
    publicSharing?: boolean;
    titleBarOverlay?: boolean;
  } = {},
): UiHost {
  return createDomUiHost(desktopPlatform, {
    nativeContextMenu: options.nativeContextMenu ?? NATIVE_CONTEXT_MENU_SUPPORTED,
    nativeWindowChrome: options.nativeWindowChrome,
    publicSharing: options.publicSharing ?? true,
    titleBarOverlay: options.titleBarOverlay,
  });
}

/**
 * Browser / hosted web. No traffic lights, so do not reserve the Mac titlebar
 * inset or the command bar sits eight columns in from the left edge.
 */
export const webUiHost: UiHost = createWebUiHost(undefined, {
  nativeContextMenu: false,
  nativeWindowChrome: false,
});

export const webRendererHost: RendererHost = {
  supportsNativeDesktopNotifications: true,
  requestExit() {
    void backendRequest("host.exit").catch(() => window.close());
  },
  startWindowDrag() {
    startElectrobunWindowDrag();
  },
  async controlWindow(action) {
    await backendRequest("host.windowControl", { action });
  },
  async openExternal(url) {
    await backendRequest("host.openExternal", { url });
  },
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await backendRequest("host.copyText", { text });
    }
  },
  async copyPngImage(pngBase64) {
    const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    try {
      const ClipboardItemCtor = (globalThis as typeof globalThis & {
        ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem;
      }).ClipboardItem;
      if (navigator.clipboard?.write && ClipboardItemCtor) {
        await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
        return;
      }
    } catch {
      // Fall through to the native Electrobun clipboard bridge.
    }
    await backendRequest("host.copyPngImage", { pngBase64 });
  },
  async readText() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return backendRequest("host.readText");
    }
  },
  async saveTextFile({ name, text, mimeType }) {
    return backendRequest("host.saveTextFile", { name, text, mimeType });
  },
  notify(notification) {
    void backendRequest("host.notify", {
      title: notification.title,
      body: notification.body,
      subtitle: notification.subtitle,
      sound: notification.sound,
    }).catch(() => {});
  },
  showContextMenu: showDesktopContextMenu,
  resolveLiveStream(request) {
    return backendRequest("media.resolveLiveStream", request);
  },
};
