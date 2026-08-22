import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KALSHI_PROXY_PATH } from "../../../shared/hosted-api";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import {
  clearPendingConnectionReports,
  setConnectionRequestReporter,
  type ConnectionRequestReport,
} from "../../builtin/connections/register";
import { fetchJson } from "./fetch";

// Buffered reports are process-wide, so traffic from any other module loaded in
// this test process would otherwise replay into the reporter under test.
beforeEach(() => {
  clearPendingConnectionReports();
});

afterEach(() => {
  setHttpFetchTransport(null);
  setConnectionRequestReporter(null);
  clearPendingConnectionReports();
});

function mockTransport(responses: Record<string, { status?: number; body: string }>): void {
  setHttpFetchTransport(async (url) => {
    const match = Object.entries(responses).find(([prefix]) => url.includes(prefix));
    if (!match) throw new Error(`Unexpected URL: ${url}`);
    const { status = 200, body } = match[1]!;
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
}

describe("prediction-markets fetch connection attribution", () => {
  test("attributes Kalshi URLs to the kalshi connection", async () => {
    const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
    setConnectionRequestReporter((id, report) => reports.push({ id, report }));
    mockTransport({ "kalshi.com": { body: '{"events":[]}' } });

    await fetchJson("https://external-api.kalshi.com/trade-api/v2/events?limit=1");

    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe("kalshi");
    expect(reports[0]!.report.success).toBe(true);
  });

  test("attributes hosted Kalshi proxy URLs to the kalshi connection", async () => {
    const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
    setConnectionRequestReporter((id, report) => reports.push({ id, report }));
    mockTransport({ [KALSHI_PROXY_PATH]: { body: '{"markets":[]}' } });

    await fetchJson(`https://terminal.kohor.st${KALSHI_PROXY_PATH}/events/MX1-5D6D7D6D7/markets`);

    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe("kalshi");
    expect(reports[0]!.report.success).toBe(true);
  });

  test("attributes Polymarket URLs to the polymarket connection", async () => {
    const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
    setConnectionRequestReporter((id, report) => reports.push({ id, report }));
    mockTransport({ "polymarket.com": { body: "[]" } });

    await fetchJson("https://gamma-api.polymarket.com/events?limit=1");

    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe("polymarket");
  });

  test("attributes Adjacent URLs to the adjacent-cloud connection, not the venue", async () => {
    const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
    setConnectionRequestReporter((id, report) => reports.push({ id, report }));
    mockTransport({ "adjacent.markets": { body: '{"data":[]}' } });

    // Adjacent catalog calls include platform=kalshi in the query string,
    // but the host is adjacent.markets so it must attribute to "adjacent-cloud".
    await fetchJson("https://api.adjacent.markets/api/v1/public/markets?platform=kalshi&limit=1");

    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe("adjacent-cloud");
  });

  test("does not report traffic for unknown URLs", async () => {
    const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
    setConnectionRequestReporter((id, report) => reports.push({ id, report }));
    mockTransport({ "example.com": { body: "{}" } });

    await fetchJson("https://api.example.com/data");

    expect(reports).toHaveLength(0);
  });

  test("records failures with the correct connection id", async () => {
    const reports: Array<{ id: string; report: ConnectionRequestReport }> = [];
    setConnectionRequestReporter((id, report) => reports.push({ id, report }));
    mockTransport({ "kalshi.com": { status: 500, body: "{}" } });

    await expect(fetchJson("https://external-api.kalshi.com/trade-api/v2/events"))
      .rejects.toThrow();

    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe("kalshi");
    expect(reports[0]!.report.success).toBe(false);
  });
});
