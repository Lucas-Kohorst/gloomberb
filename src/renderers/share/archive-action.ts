import { useCallback } from "react";
import { archiveIsOpenUrl } from "../../shares/archive";

function openArchiveUrl(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}

export function useShareArticleArchive(rawUrl: string | null | undefined): {
  archive: () => void;
  enabled: boolean;
} {
  const openUrl = archiveIsOpenUrl(rawUrl);

  const archive = useCallback(() => {
    if (!openUrl) return;
    openArchiveUrl(openUrl);
  }, [openUrl]);

  return { archive, enabled: !!openUrl };
}
