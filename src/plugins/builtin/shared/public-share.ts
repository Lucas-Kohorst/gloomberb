import { useCallback } from "react";
import { useRendererHost } from "../../../ui";
import { publishShare } from "../../../shares/publish";
import type { SharePayload } from "../../../shares/payload";
import { usePluginAppActions } from "../../runtime";

export function usePublicShare(): (payload: SharePayload) => Promise<void> {
  const renderer = useRendererHost();
  const { notify } = usePluginAppActions();

  return useCallback(async (payload: SharePayload) => {
    try {
      await renderer.copyText(await publishShare(payload));
      notify({ body: "Share link copied to clipboard", type: "success" });
    } catch (error) {
      notify({
        body: error instanceof Error ? error.message : "Could not create share.",
        type: "error",
      });
    }
  }, [notify, renderer]);
}
