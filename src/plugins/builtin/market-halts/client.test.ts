import { describe, expect, test } from "bun:test";
import { parseHaltFeed } from "./client";

const SAMPLE_HALTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:ndaq="http://www.nasdaqtrader.com/rss.dtd">
  <channel>
    <item>
      <ndaq:HaltDate>08/18/2026</ndaq:HaltDate>
      <ndaq:HaltTime>13:25:32.636</ndaq:HaltTime>
      <ndaq:IssueSymbol>WETO</ndaq:IssueSymbol>
      <ndaq:IssueName>Wetouch Technology Inc. Common Stock</ndaq:IssueName>
      <ndaq:Market>NASDAQ</ndaq:Market>
      <ndaq:ReasonCode>LUDP</ndaq:ReasonCode>
      <ndaq:PauseThresholdPrice />
      <ndaq:ResumptionDate>08/18/2026</ndaq:ResumptionDate>
      <ndaq:ResumptionQuoteTime>13:30:32</ndaq:ResumptionQuoteTime>
      <ndaq:ResumptionTradeTime>13:35:32</ndaq:ResumptionTradeTime>
    </item>
  </channel>
</rss>`;

describe("parseHaltFeed", () => {
  test("parses a Nasdaq item into the current HaltRecord shape", () => {
    const result = parseHaltFeed(SAMPLE_HALTS_XML);

    expect(result.itemCount).toBe(1);
    expect(result.records).toHaveLength(1);

    const halt = result.records[0]!;
    expect(halt).toMatchObject({
      id: "WETO|08/18/2026|13:25:32.636|LUDP",
      symbol: "WETO",
      company: "Wetouch Technology Inc. Common Stock",
      market: "NASDAQ",
      reasonCode: "LUDP",
      reason: "Volatility pause",
    });
    expect(new Date(halt.haltedAt).toISOString()).toBe("2026-08-18T17:25:32.636Z");
    expect(new Date(halt.quoteResumeAt!).toISOString()).toBe("2026-08-18T17:30:32.000Z");
    expect(new Date(halt.tradeResumeAt!).toISOString()).toBe("2026-08-18T17:35:32.000Z");
  });
});
