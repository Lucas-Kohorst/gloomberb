import type { ShareKind } from "../shares/payload";

/** Read-only compatibility for historical desktop deep links. New shares use shares/publish. */
export interface ResolveShareResponse {
  kind: ShareKind;
  data: unknown;
  createdAt: string;
}

export async function resolveShare(id: string): Promise<ResolveShareResponse | null> {
  const origin = typeof window !== "undefined" ? window.location?.origin ?? "" : "";
  const response = await fetch(`${origin}/api/share/${encodeURIComponent(id)}`,
    { credentials: "include" });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("This older share could not be loaded.");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!["article", "chart", "table", "pane"].includes(String(record.kind))
    || typeof record.createdAt !== "string" || !("data" in record)) return null;
  return record as unknown as ResolveShareResponse;
}
