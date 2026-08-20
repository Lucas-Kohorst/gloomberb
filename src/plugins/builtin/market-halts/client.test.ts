import { describe, expect, test } from "bun:test";
import { parseHaltsXml } from "./client";

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

describe("parseHaltsXml", () => {
  test("parses populated ndaq tags and ignores genuine self-closing fields", () => {
    const rows = parseHaltsXml(SAMPLE_HALTS_XML);
    expect(rows).toHaveLength(1);

    const halt = rows[0]!;
    expect(halt.ticker).toBe("WETO");
    expect(halt.name).toBe("Wetouch Technology Inc. Common Stock");
    expect(halt.exchange).toBe("NASDAQ");
    expect(halt.haltCode).toBe("LUDP");
    expect(halt.haltCodeDesc).toBe("Volatility Trading Pause (5 min)");
    expect(halt.haltTime.toISOString()).toBe("2026-08-18T17:25:32.000Z");
    expect(halt.quoteResumeTime?.toISOString()).toBe("2026-08-18T17:30:32.000Z");
    expect(halt.resumeTime?.toISOString()).toBe("2026-08-18T17:35:32.000Z");
    expect(halt.status).toBe("resumed");
  });
});
