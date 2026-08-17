import { useCallback } from "react";
import { useRendererHost } from "../../../ui";
import { usePluginAppActions } from "../../runtime";
import { createShare } from "../../../sources/share-service";
import { buildShortShareUrl, type ShareKind } from "./share-link";

/**
 * Returns a function that stores a share payload via the short-ID backend and
 * copies the resulting compact URL to the clipboard.
 *
 * Chart and table shares require a verified session on the hosted web client.
 * Article shares may be created anonymously. On the desktop client the share
 * API is unreachable from the terminal origin — use the article inline
 * fallback (`useCopyShareLink`) or expect an error notification.
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
