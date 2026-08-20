import { useCallback, useState } from "react";
import type { ArticleArchiveResult } from "../../../shares/archive";
import { lookupArchiveIsSnapshot, publisherArticleUrl } from "../../../shares/archive";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { useRendererHost } from "../../../ui";

export const ARCHIVE_IS_CONNECTION_ID = "archive-is";

function usesHostedArchiveApi(): boolean {
  if (typeof window === "undefined") return false;
  return (window as Window & { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED === true;
}

async function fetchHostedArchiveLookup(sourceUrl: string, signal?: AbortSignal): Promise<ArticleArchiveResult> {
  const response = await fetch(`/api/archive?url=${encodeURIComponent(sourceUrl)}`, {
    signal,
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => null) as ArticleArchiveResult | { error?: string } | null;
  if (body && typeof body === "object" && "status" in body) return body;
  const message = body && typeof body === "object" && typeof body.error === "string"
    ? body.error
    : `archive.is lookup failed (${response.status}).`;
  return { status: "error", message };
}

export async function resolveArticleArchive(
  rawUrl: string | null | undefined,
  signal?: AbortSignal,
): Promise<ArticleArchiveResult> {
  const sourceUrl = publisherArticleUrl(rawUrl);
  if (!sourceUrl) return { status: "error", message: "No publisher URL to archive." };
  return withConnectionRequest(ARCHIVE_IS_CONNECTION_ID, "lookup snapshot", () => (
    usesHostedArchiveApi()
      ? fetchHostedArchiveLookup(sourceUrl, signal)
      : lookupArchiveIsSnapshot(sourceUrl, httpFetch, signal)
  ));
}

export function useArticleArchiveAction(rawUrl: string | null | undefined): {
  archive: () => void;
  loading: boolean;
  error: string | null;
} {
  const renderer = useRendererHost();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archive = useCallback(() => {
    const sourceUrl = publisherArticleUrl(rawUrl);
    if (!sourceUrl) {
      setError("No publisher URL to archive.");
      return;
    }
    setLoading(true);
    setError(null);
    void resolveArticleArchive(sourceUrl).then(async (result) => {
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      await renderer.openExternal(result.url);
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Could not reach archive.is.");
    }).finally(() => {
      setLoading(false);
    });
  }, [rawUrl, renderer]);

  return { archive, loading, error };
}
