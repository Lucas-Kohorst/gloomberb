import { describe, expect, test } from "bun:test";
import { parseByokPayload, resolveByokDataFormat } from "./format";

describe("resolveByokDataFormat", () => {
  test("honors an explicit format over content sniffing", () => {
    expect(resolveByokDataFormat("text", "application/json", "[1]")).toBe("text");
    expect(resolveByokDataFormat("csv", "text/plain", "a,b")).toBe("csv");
  });

  test("sniffs json, csv, and text from content type or body", () => {
    expect(resolveByokDataFormat("auto", "application/json", "")).toBe("json");
    expect(resolveByokDataFormat("auto", "text/csv", "")).toBe("csv");
    expect(resolveByokDataFormat("auto", "text/plain", '[{"a":1}]')).toBe("json");
    expect(resolveByokDataFormat("auto", "text/plain", "name,value")).toBe("csv");
    expect(resolveByokDataFormat("auto", "text/plain", "hello")).toBe("text");
  });
});

describe("parseByokPayload", () => {
  test("turns a json object array into a table", () => {
    const payload = parseByokPayload("json", "", JSON.stringify([
      { id: 1, name: "alpha" },
      { id: 2, name: "beta", extra: true },
    ]));
    expect(payload).toEqual({
      kind: "table",
      columns: ["id", "name", "extra"],
      rows: [
        { id: "1", name: "alpha", extra: "" },
        { id: "2", name: "beta", extra: "true" },
      ],
    });
  });

  test("uses the first nested record array inside a json object", () => {
    const payload = parseByokPayload("json", "", JSON.stringify({
      count: 2,
      items: [{ symbol: "AAPL", px: 10 }, { symbol: "MSFT", px: 20 }],
    }));
    expect(payload.kind).toBe("table");
    if (payload.kind !== "table") return;
    expect(payload.columns).toEqual(["symbol", "px"]);
    expect(payload.rows).toHaveLength(2);
  });

  test("renders a flat json object as key/value pairs", () => {
    const payload = parseByokPayload("json", "", JSON.stringify({ ok: true, name: "Furnace" }));
    expect(payload).toEqual({
      kind: "pairs",
      pairs: [
        { key: "ok", value: "true" },
        { key: "name", value: "Furnace" },
      ],
    });
  });

  test("falls back to text when json is invalid", () => {
    expect(parseByokPayload("json", "", "not-json")).toEqual({ kind: "text", text: "not-json" });
  });

  test("parses csv including quoted commas", () => {
    const payload = parseByokPayload("csv", "", "name,note\nFurnace,\"hot, fast\"\n");
    expect(payload).toEqual({
      kind: "table",
      columns: ["name", "note"],
      rows: [{ name: "Furnace", note: "hot, fast" }],
    });
  });
});
