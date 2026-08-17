import { useCallback } from "react";
import { useRendererHost } from "../../../ui";
import { usePluginAppActions } from "../../runtime";
import { createShare } from "../../../sources/share-service";
import { buildShortShareUrl } from "../../../shares/routes";
import { buildTableSharePayload, type TableSnapshotInput } from "../../../shares/table-snapshot";

/**
 * Copies a share link for a pane's table.
 *
 * Panes pass the columns they already render plus a cell accessor, so the shared
 * snapshot shows the same formatted values the sharer was looking at rather than
 * a re-query the recipient may not be entitled to run.
 */
export function useShareTable(): <T>(input: TableSnapshotInput<T>) => Promise<void> {
  const rendererHost = useRendererHost();
  const { notify } = usePluginAppActions();

  return useCallback(async <T,>(input: TableSnapshotInput<T>) => {
    if (input.items.length === 0) {
      notify({ body: "Nothing to share yet", type: "info" });
      return;
    }
    try {
      const { id } = await createShare({ kind: "table", data: buildTableSharePayload(input) });
      await rendererHost.copyText(buildShortShareUrl(id));
      notify({ body: "Share link copied to clipboard", type: "success" });
    } catch (error) {
      notify({
        body: error instanceof Error ? error.message : "Failed to create share link",
        type: "error",
      });
    }
  }, [notify, rendererHost]);
}
