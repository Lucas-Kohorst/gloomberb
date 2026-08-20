import { useCallback, useState } from "react";
import type { ArticleArchiveResult } from "../../shares/archive";
import { publisherArticleUrl } from "../../shares/archive";

async function lookupViaHostedApi(sourceUrl: string, signal?: AbortSignal): Promise<ArticleArchiveResult> {
  const response = await fetch(`/api/archive?url=${encodeURIComponent(sourceUrl)}`, { signal });
  const body = await response.json().catch(() => null) as ArticleArchiveResult | { error?: string } | null;
  if (body && typeof body === "object" && "status" in body) return body;
  const message = body && typeof body === "object" && typeof body.error === "string"
    ? body.error
    : `archive.is lookup failed (${response.status}).`;
  return { status: "error", message };
}

function openArchiveUrl(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}

export function useShareArticleArchive(rawUrl: string | null | undefined): {
  archive: () => void;
  loading: boolean;
  error: string | null;
  enabled: boolean;
} {
  const sourceUrl = publisherArticleUrl(rawUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archive = useCallback(() => {
    if (!sourceUrl) {
      setError("No publisher URL to archive.");
      return;
    }
    setLoading(true);
    setError(null);
    void lookupViaHostedApi(sourceUrl)
      .then((result) => {
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        openArchiveUrl(result.url);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not reach archive.is.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [sourceUrl]);

  return { archive, loading, error, enabled: !!sourceUrl };
}
