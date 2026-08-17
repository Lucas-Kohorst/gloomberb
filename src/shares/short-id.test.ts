import { describe, expect, test } from "bun:test";
import { generateShareId, isShareId, SHARE_ID_LENGTH } from "./short-id";

describe("generateShareId", () => {
  test("returns a fixed-length base62 id", () => {
    const id = generateShareId();
    expect(id).toHaveLength(SHARE_ID_LENGTH);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
    expect(isShareId(id)).toBe(true);
  });

  test("uses the provided entropy source so ids are deterministic in tests", () => {
    const bytes = new Uint8Array(SHARE_ID_LENGTH).fill(0);
    expect(generateShareId(() => bytes)).toBe("A".repeat(SHARE_ID_LENGTH));
  });

  test("rejects ids outside the share API length window", () => {
    expect(isShareId("short")).toBe(false);
    expect(isShareId("a".repeat(65))).toBe(false);
    expect(isShareId("abcdefghijkl")).toBe(true);
  });
});
