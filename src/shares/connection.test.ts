import { expect, test } from "bun:test";
import { clearPendingConnectionReports, setConnectionRequestReporter, type ConnectionRequestReport } from "../plugins/builtin/connections/register";
import { createHostedShare, getNewsShare, getShare, registerNewsShare } from "./api";
import { SHARE_CONNECTION_ID } from "./connection";

test("hosted fallback and news index fetches report success, HTTP failures and network errors", async () => {
  clearPendingConnectionReports();
  const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
  setConnectionRequestReporter((id, report) => reports.push({ id, report }));
  try {
    await createHostedShare({ kind: "article", data: { title: "Story", text: "Body" } }, async () => Response.json({ id: "Xk9mQ2nLp4Ab" }));
    await getShare("Xk9mQ2nLp4Ab", async () => new Response(null, { status: 404 }));
    await getNewsShare("story", async () => new Response(null, { status: 404 }));
    await registerNewsShare("story", "0123456789abcdef0123456789abcdef", async () => { throw new Error("offline"); });
    expect(reports.map(({ id }) => id)).toEqual(Array(4).fill(SHARE_CONNECTION_ID));
    expect(reports.map(({ report }) => [report.operation, report.success, report.error])).toEqual([
      ["POST", true, undefined], ["GET", false, "HTTP 404"], ["GET", false, "HTTP 404"], ["PUT", false, "offline"],
    ]);
    expect(reports.every(({ report }) => report.durationMs >= 0)).toBe(true);
  } finally {
    setConnectionRequestReporter(null);
    clearPendingConnectionReports();
  }
});
