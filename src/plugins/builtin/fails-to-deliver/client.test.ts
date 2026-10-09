import { crc32 } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { newestFailsZipUrl, parseFails, readArchiveText } from "./client";

const PIPE = [
  "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE",
  "20260901|037833100|AAPL|10|APPLE INC|185.50",
  "20260915|594918104|MSFT|99|MICROSOFT CORP|.",
].join("\n");

const CSV = [
  "20260901,037833100,AAPL,15,\"APPLE, INC\",180.25",
  "20260903,88160R101,TSLA,500,TESLA INC,250",
  "20260902,037833100,aapl,40,APPLE INC,181",
].join("\n");

describe("fails to deliver parsing", () => {
  test("parses two pipe rows, skipping the header and a missing price", () => {
    const report = parseFails(PIPE);
    expect(report.settlementDate).toBe("2026-09-15");
    expect(report.rows).toEqual([
      {
        id: "2026-09-15|594918104|MSFT",
        symbol: "MSFT",
        description: "MICROSOFT CORP",
        quantity: 99,
        price: null,
        date: "2026-09-15",
      },
      {
        id: "2026-09-01|037833100|AAPL",
        symbol: "AAPL",
        description: "APPLE INC",
        quantity: 10,
        price: 185.5,
        date: "2026-09-01",
      },
    ]);
  });

  test("parses csv rows and filters to a symbol before the cap", () => {
    const quoted = parseFails(CSV.split("\n").slice(0, 2).join("\n"));
    expect(quoted.rows.map((row) => [row.symbol, row.description, row.quantity])).toEqual([
      ["TSLA", "TESLA INC", 500],
      ["AAPL", "APPLE, INC", 15],
    ]);

    const filtered = parseFails(CSV, { symbol: "aapl", limit: 1 });
    expect(filtered.settlementDate).toBe("2026-09-02");
    expect(filtered.rows).toEqual([
      {
        id: "2026-09-02|037833100|AAPL",
        symbol: "AAPL",
        description: "APPLE INC",
        quantity: 40,
        price: 181,
        date: "2026-09-02",
      },
    ]);
  });

  test("picks the newest dated archive, not the first or last link", () => {
    const html = [
      '<a href="/files/data/fails-deliver-data/cnsfails202608b.zip">older</a>',
      '<a href="/files/data/fails-deliver-data/cnsfails202609a.zip">newest</a>',
      '<a href="/files/data/other/fails-deliver-data/cnsfails202601b.zip">last</a>',
    ].join("");
    expect(newestFailsZipUrl(html)).toBe("https://www.sec.gov/files/data/fails-deliver-data/cnsfails202609a.zip");
    expect(() => newestFailsZipUrl("<html></html>")).toThrow("No fails file was listed");
  });

  test("reads a stored member whose sizes live in the central directory", async () => {
    const name = "cnsfails202609a.txt";
    const text = "20260915|594918104|MSFT|99|MICROSOFT CORP|.\n";
    expect(await readArchiveText(storedZip(name, text))).toBe(text);
  });
});

function le(size: number, value: number): Buffer {
  const bytes = Buffer.alloc(size);
  if (size === 2) bytes.writeUInt16LE(value);
  else bytes.writeUInt32LE(value);
  return bytes;
}

/** A one-member stored zip with an empty local size and a data descriptor. */
function storedZip(name: string, text: string): Uint8Array {
  const fileName = Buffer.from(name);
  const data = Buffer.from(text);
  const sum = crc32(data) >>> 0;
  const local = Buffer.concat([
    le(4, 0x04034b50), le(2, 20), le(2, 0x8), le(2, 0), le(2, 0), le(2, 0),
    le(4, 0), le(4, 0), le(4, 0), le(2, fileName.length), le(2, 0), fileName, data,
    le(4, 0x08074b50), le(4, sum), le(4, data.length), le(4, data.length),
  ]);
  const central = Buffer.concat([
    le(4, 0x02014b50), le(2, 20), le(2, 20), le(2, 0x8), le(2, 0), le(2, 0), le(2, 0),
    le(4, sum), le(4, data.length), le(4, data.length), le(2, fileName.length),
    le(2, 0), le(2, 0), le(2, 0), le(2, 0), le(4, 0), le(4, 0), fileName,
  ]);
  const eocd = Buffer.concat([
    le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, 1), le(2, 1),
    le(4, central.length), le(4, local.length), le(2, 0),
  ]);
  return new Uint8Array(Buffer.concat([local, central, eocd]));
}
