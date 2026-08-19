import { JINA_READER_ENDPOINT, JINA_READER_HEADERS } from "../../../plugins/builtin/shared/jina-article-text";
import type { KeyedDataProvider, ProviderPlan } from "./types";

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (host === "::1" || host === "::") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export const jinaAiProvider: KeyedDataProvider = {
  id: "jina-ai",
  name: "Jina AI Reader",
  ttlSeconds: 300,
  userAgent: "gloomberb-jina",
  resolve({ search }): ProviderPlan {
    const raw = search.get("url")?.trim() ?? "";
    if (!raw) {
      return { kind: "error", status: 400, error: "url query is required" };
    }
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return { kind: "error", status: 400, error: "Invalid article URL" };
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return { kind: "error", status: 400, error: "Article URL must use HTTP or HTTPS" };
    }
    if (isPrivateHostname(target.hostname)) {
      return { kind: "error", status: 403, error: "Blocked target" };
    }
    return {
      kind: "proxy",
      url: `${JINA_READER_ENDPOINT}${target.toString()}`,
      extraHeaders: JINA_READER_HEADERS,
    };
  },
};
