import { afterEach, describe, expect, test } from "bun:test";
import {
  clearPendingConnectionReports,
  setConnectionRequestReporter,
} from "../connections/register";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { searchCommunityPlugins } from "./search";

afterEach(() => {
  setHttpFetchTransport(null);
  setConnectionRequestReporter(null);
  clearPendingConnectionReports();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("searchCommunityPlugins", () => {
  test("uses the gloomberb-plugin topic first, then keyword fallback", async () => {
    const urls: string[] = [];
    setHttpFetchTransport(async (url) => {
      urls.push(String(url));
      const parsed = new URL(String(url));
      if (parsed.searchParams.get("q")?.includes("topic:gloomberb-plugin")) {
        return jsonResponse(200, { items: [] });
      }
      return jsonResponse(200, {
        items: [{
          id: 9,
          name: "beta",
          full_name: "someone/beta",
          description: "Gloomberb pane",
          stargazers_count: 4,
          html_url: "https://github.com/someone/beta",
          owner: { login: "someone" },
          updated_at: "2026-08-01T00:00:00Z",
        }],
      });
    });

    const reports: Array<{ ok: boolean; operation?: string }> = [];
    setConnectionRequestReporter((_id, report) => {
      reports.push({ ok: report.success, operation: report.operation });
    });

    const results = await searchCommunityPlugins("beta");
    expect(results).toEqual([{
      id: 9,
      fullName: "someone/beta",
      description: "Gloomberb pane",
      stars: 4,
      url: "https://github.com/someone/beta",
      owner: "someone",
      updatedAt: "2026-08-01T00:00:00Z",
    }]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("topic%3Agloomberb-plugin");
    expect(urls[1]).toContain("gloomberb");
    expect(reports).toEqual([{ ok: true, operation: "beta" }]);
  });

  test("does not fall back when the topic search returns plugins", async () => {
    const urls: string[] = [];
    setHttpFetchTransport(async (url) => {
      urls.push(String(url));
      return jsonResponse(200, {
        items: [{
          id: 1,
          name: "alpha",
          full_name: "org/alpha",
          description: null,
          stargazers_count: 2,
          html_url: "https://github.com/org/alpha",
          owner: { login: "org" },
          updated_at: "2026-08-01T00:00:00Z",
        }],
      });
    });

    const results = await searchCommunityPlugins("alpha");
    expect(results.map((row) => row.fullName)).toEqual(["org/alpha"]);
    expect(urls).toHaveLength(1);
  });

  test("reports GitHub errors through the connection tracker", async () => {
    setHttpFetchTransport(async () => jsonResponse(403, { message: "rate limited" }));
    const reports: Array<{ ok: boolean }> = [];
    setConnectionRequestReporter((_id, report) => {
      reports.push({ ok: report.success });
    });
    await expect(searchCommunityPlugins("charts")).rejects.toThrow("GitHub search failed (403)");
    expect(reports).toEqual([{ ok: false }]);
  });
});
