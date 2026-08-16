import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { openUrl } from "./external-link";

const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
  (() => ({ unref: () => {}, exited: Promise.resolve(0) })) as any,
);

afterEach(() => {
  spawnSpy.mockClear();
});

describe("openUrl scheme validation", () => {
  test("opens https URLs", () => {
    openUrl("https://example.com");
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  test("opens http URLs", () => {
    openUrl("http://example.com");
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects file:// URLs without spawning", () => {
    openUrl("file:///etc/passwd");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("rejects javascript: URLs without spawning", () => {
    openUrl("javascript:alert(1)");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("rejects empty strings without spawning", () => {
    openUrl("");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("rejects malformed URLs without spawning", () => {
    openUrl("not-a-url");
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
