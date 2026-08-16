import { useCallback } from "react";
import { useRendererHost } from "../../../ui";
import { usePluginAppActions } from "../../runtime";
import { createShare } from "../../../sources/share-service";
import { buildShortShareUrl, type ShareKind } from "./share-link";

/**
 * Returns a function that stores a share payload via the short-ID backend and
 * copies the resulting compact URL to the clipboard.
 *
 * On the hosted web client this requires a verified session (the worker
 * rejects anonymous share creation). On the desktop client the share URL
 * points at the hosted origin, which is unreachable from the terminal — so
 * the hook notifies the user instead of silently failing.
 */
export function useShareView(): (kind: ShareKind, data: unknown) => Promise<void> {
  const rendererHost = useRendererHost();
  const { notify } = usePluginAppActions();

  return useCallback(
    async (kind: ShareKind, data: unknown) => {
      try {
        const { id } = await createShare({ kind, data });
        const url = buildShortShareUrl(id);
        await rendererHost.copyText(url);
        notify({ body: "Share link copied to clipboard", type: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create share link";
        notify({ body: message, type: "error" });
      }
    },
    [rendererHost, notify],
  );
}
