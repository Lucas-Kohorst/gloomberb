import type { AppNotificationRequest } from "../types/plugin";
import { createShare, openLiveShareUrl } from "./api";
import type { SharePayload } from "./payload";

/**
 * Every share is a live hand-off: the link opens the hosted terminal on the
 * same pane the sender is looking at. One implementation, so the shell
 * shortcut, the pane menu, and pane-level share hints cannot drift apart.
 */
export async function copyLivePaneShare(
  payload: Extract<SharePayload, { kind: "pane" }>,
  host: {
    copyText: (text: string) => Promise<void> | void;
    notify: (notification: AppNotificationRequest) => void;
  },
): Promise<void> {
  try {
    const { id } = await createShare(payload);
    await host.copyText(openLiveShareUrl(id));
    host.notify({ body: "Share link copied to clipboard", type: "success" });
  } catch (error) {
    host.notify({
      body: error instanceof Error ? error.message : "Could not share this pane.",
      type: "error",
    });
  }
}
