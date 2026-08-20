import { useCallback } from "react";
import { archiveIsOpenUrl } from "../../../shares/archive";
import { useRendererHost } from "../../../ui";

export function useArticleArchiveAction(rawUrl: string | null | undefined): {
  archive: () => void;
  enabled: boolean;
} {
  const renderer = useRendererHost();
  const openUrl = archiveIsOpenUrl(rawUrl);

  const archive = useCallback(() => {
    if (!openUrl) return;
    void renderer.openExternal(openUrl);
  }, [openUrl, renderer]);

  return { archive, enabled: !!openUrl };
}
