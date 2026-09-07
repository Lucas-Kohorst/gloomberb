import { useCallback } from "react";
import { useRendererHost } from "../../../ui";
import { usePluginAppActions } from "../../runtime";
import { publishShare } from "../../../shares/publish";
import { parseSharePayload, type ShareKind } from "../../../shares/payload";

/**
 * Publishes a supported stored snapshot and copies its public URL.
 */
export function useShareView(): (kind: ShareKind, data: unknown) => Promise<void> {
  const rendererHost = useRendererHost();
  const { notify } = usePluginAppActions();

  return useCallback(
    async (kind: ShareKind, data: unknown) => {
      try {
        const payload = parseSharePayload({ kind, data });
        if (!payload) throw new Error("Invalid share payload.");
        const url = await publishShare(payload);
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
