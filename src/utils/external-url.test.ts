import { describe, expect, test } from "bun:test";
import { safeExternalUrl } from "./external-url";

describe("safeExternalUrl", () => {
  test("accepts the web schemes and returns the normalised URL", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("  https://example.com/x  ")).toBe("https://example.com/x");
  });

  test("rejects schemes that would let a feed reach the local machine", () => {
    // These reach openUrl straight from RSS, news, and market payloads, and
    // end up as arguments to `open` / `xdg-open` / `cmd /c start`.
    for (const hostile of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "smb://attacker/share",
      "gloomberb://open",
    ]) {
      expect(safeExternalUrl(hostile)).toBeNull();
    }
  });

  test("rejects input that is not a URL at all", () => {
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl("not-a-url")).toBeNull();
    expect(safeExternalUrl("//example.com")).toBeNull();
  });
});
