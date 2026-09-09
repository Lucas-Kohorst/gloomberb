import { describe, expect, test } from "bun:test";
import { safeExternalUrl, openUrlCommand } from "./external-url";

describe("safeExternalUrl", () => {
  test("accepts the web schemes and returns the normalised URL", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("  https://example.com/x  ")).toBe("https://example.com/x");
  });

  test("rejects schemes that would let a feed reach the local machine", () => {
    // These reach openUrl straight from RSS, news, and market payloads, and
    // end up as arguments to `open` / `xdg-open` / `explorer`.
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

describe("openUrlCommand", () => {
  test("never uses cmd.exe on Windows — uses explorer (ShellExecute) instead", () => {
    // ui-widgets-002: cmd /c start reinterprets & and other metacharacters in
    // an unquoted URL as command separators. explorer uses ShellExecute and
    // never touches cmd's parser.
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const cmd = openUrlCommand("https://example.com/article?a=1&b=2");
    expect(cmd).not.toBeNull();
    expect(cmd![0]).toBe("explorer");
    expect(cmd!.join(" ")).not.toContain("cmd");
    expect(cmd!.join(" ")).not.toContain("start");

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  test("URLs with & in query strings survive on Windows", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const cmd = openUrlCommand("https://example.com/search?q=hello&lang=en");
    expect(cmd).not.toBeNull();
    expect(cmd![cmd!.length - 1]).toBe("https://example.com/search?q=hello&lang=en");

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  test("returns null for empty input", () => {
    expect(openUrlCommand("")).toBeNull();
  });

  test("uses open on darwin and xdg-open on linux", () => {
    const originalPlatform = process.platform;

    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    expect(openUrlCommand("https://example.com")![0]).toBe("open");

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    expect(openUrlCommand("https://example.com")![0]).toBe("xdg-open");

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});
