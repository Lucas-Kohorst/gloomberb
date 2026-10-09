import { describe, expect, test } from "bun:test";
import { readZipTexts } from "./zip-text";

const FIXTURE = Buffer.from(
  "UEsDBBQAAAAIALh0SV1WF354FwAAABUAAAALAAAAZmFjdG9ycy5jc3ZLSSxJ1cnNLuEyMjAy0TUw1DHQM+UCAFBLAQIUAxQAAAAIALh0SV1WF354FwAAABUAAAALAAAAAAAAAAAAAACAAQAAAABmYWN0b3JzLmNzdlBLBQYAAAAAAQABADkAAABAAAAAAAA=",
  "base64",
);

describe("readZipTexts", () => {
  test("inflates a deflate member", async () => {
    const entries = await readZipTexts(FIXTURE);
    expect(entries.map((entry) => entry.name)).toEqual(["factors.csv"]);
    expect(entries[0]?.text).toBe("date,mkt\n2024-01,0.5\n");
  });

  test("refuses an empty buffer", async () => {
    await expect(readZipTexts(new Uint8Array())).rejects.toThrow("The archive had no files");
  });
});
