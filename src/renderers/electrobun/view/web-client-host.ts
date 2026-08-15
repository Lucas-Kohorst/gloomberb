import type { RendererHost } from "../../../ui/host";
import { webRendererHost } from "./ui-host";

export const localWebRendererHost: RendererHost = {
  ...webRendererHost,
  supportsNativeDesktopNotifications: false,
  requestExit() {},
  startWindowDrag: undefined,
  controlWindow: undefined,
  openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  },
  showContextMenu: undefined,
  notify(notification) {
    if (Notification.permission === "granted") {
      new Notification(notification.title ?? "Gloomberb", { body: notification.body });
    }
  },
};
