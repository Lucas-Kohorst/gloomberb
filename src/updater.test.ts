import { afterEach, describe, expect, it, test } from "bun:test";
import { createHash } from "crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gzipSync } from "zlib";
import {
  checkForUpdate,
  checkForUpdateDetailed,
  detectUpdateAction,
  getAssetBaseNameForRuntime,
  performUpdate,
  resolveSelfUpdateTargetPath,
  setUpdateHost,
  __resetRosettaCache,
  type ReleaseInfo,
  type UpdateProgress,
} from "./updater";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setUpdateHost(null);
  __resetRosettaCache();
});

function expectedAssetName(compressed = false): string {
  const base = getAssetBaseNameForRuntime();
  return compressed ? `${base}.gz` : base;
}

/**
 * Simulate a genuine Intel Mac process: darwin x64 standalone binary, with
 * sysctl reporting neither Rosetta translation nor arm64 hardware. Restores
 * process metadata, the Rosetta cache, and the Bun.spawnSync mock.
 */
function mockIntelMacRuntime(): () => void {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  const originalExecPath = process.execPath;
  const originalArgv = process.argv;
  const originalSpawnSync = Bun.spawnSync;
  __resetRosettaCache();
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  Object.defineProperty(process, "arch", { value: "x64", configurable: true });
  Object.defineProperty(process, "execPath", { value: "/Applications/gloomberb", configurable: true });
  Object.defineProperty(process, "argv", { value: ["/Applications/gloomberb"], configurable: true });
  Bun.spawnSync = (() => ({
    success: true,
    stdout: new TextEncoder().encode("0"),
    stderr: new Uint8Array(0),
    exitCode: 0,
  })) as typeof Bun.spawnSync;
  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true });
    Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
    Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    Bun.spawnSync = originalSpawnSync;
    __resetRosettaCache();
  };
}

describe("getAssetBaseNameForRuntime", () => {
  test("uses the Windows executable release asset name on win32 x64", () => {
    expect(getAssetBaseNameForRuntime({
      platform: "win32",
      arch: "x64",
    })).toBe("gloomberb-windows-x64.exe");
  });

  test("selects arm64 for native Apple Silicon (darwin arm64)", () => {
    expect(getAssetBaseNameForRuntime({
      platform: "darwin",
      arch: "arm64",
    })).toBe("gloomberb-darwin-arm64");
  });

  test("selects arm64 for darwin x64 under Rosetta 2", () => {
    expect(getAssetBaseNameForRuntime({
      platform: "darwin",
      arch: "x64",
    }, true)).toBe("gloomberb-darwin-arm64");
  });

  test("selects x64 for genuine Intel Mac (darwin x64, not Rosetta)", () => {
    expect(getAssetBaseNameForRuntime({
      platform: "darwin",
      arch: "x64",
    }, false)).toBe("gloomberb-darwin-x64");
  });

  test("selects arm64 for linux arm64", () => {
    expect(getAssetBaseNameForRuntime({
      platform: "linux",
      arch: "arm64",
    })).toBe("gloomberb-linux-arm64");
  });

  test("selects x64 for linux x64", () => {
    expect(getAssetBaseNameForRuntime({
      platform: "linux",
      arch: "x64",
    })).toBe("gloomberb-linux-x64");
  });

  test("does not treat darwin x64 as arm64 when Rosetta is not detected", () => {
    const restore = mockIntelMacRuntime();
    try {
      // Without the isRosettaTranslated override the decision must come from
      // the Rosetta detector, not a hardcoded assumption. The mocked sysctl
      // says this x64 process is genuine Intel hardware, so the result is the
      // x64 asset — deterministic on any test machine.
      expect(getAssetBaseNameForRuntime({
        platform: "darwin",
        arch: "x64",
      })).toBe("gloomberb-darwin-x64");
    } finally {
      restore();
    }
  });
});

describe("detectUpdateAction", () => {
  test("uses self-update for standalone binaries", () => {
    expect(detectUpdateAction(
      "/Users/vince/.local/bin/gloomberb",
      ["/Users/vince/.local/bin/gloomberb"],
    )).toEqual({ kind: "self" });
  });

  test("uses manual bun updates for bun-managed installs", () => {
    expect(detectUpdateAction(
      "/opt/homebrew/bin/bun",
      ["/opt/homebrew/bin/bun", "/Users/vince/.bun/install/global/node_modules/gloomberb/bin/gloomberb"],
    )).toEqual({
      kind: "manual",
      command: "bun install -g gloomberb@latest",
    });
  });

  test("uses manual bun updates for Windows bun-managed installs", () => {
    expect(detectUpdateAction(
      "C:\\Program Files\\Bun\\bun.exe",
      ["C:\\Program Files\\Bun\\bun.exe", "C:\\Users\\vince\\.bun\\install\\global\\node_modules\\gloomberb\\bin\\gloomberb"],
    )).toEqual({
      kind: "manual",
      command: "bun install -g gloomberb@latest",
    });
  });

  test("uses manual npm updates for node-managed installs", () => {
    expect(detectUpdateAction(
      "/opt/homebrew/bin/node",
      ["/opt/homebrew/bin/node", "/usr/local/lib/node_modules/gloomberb/bin/gloomberb"],
    )).toEqual({
      kind: "manual",
      command: "npm install -g gloomberb@latest",
    });
  });

  test("does not offer self-update for standalone Windows executables", () => {
    expect(detectUpdateAction(
      "C:\\Users\\vince\\Downloads\\gloomberb.exe",
      ["C:\\Users\\vince\\Downloads\\gloomberb.exe"],
    )).toBeNull();
  });

  test("skips updates when launched from source under bun", () => {
    expect(detectUpdateAction(
      "/opt/homebrew/bin/bun",
      ["/opt/homebrew/bin/bun", "src/index.tsx"],
    )).toBeNull();
  });

  test("does not treat a macOS app bundle launcher as a standalone CLI binary", () => {
    expect(detectUpdateAction(
      "/Applications/Gloomberb.app/Contents/MacOS/launcher",
      ["/Applications/Gloomberb.app/Contents/MacOS/launcher"],
    )).toBeNull();
  });

  test("does not suggest Bun-managed updates for the bundled macOS app runtime", () => {
    expect(detectUpdateAction(
      "/Applications/Gloomberb.app/Contents/MacOS/bun",
      ["/Applications/Gloomberb.app/Contents/MacOS/bun", "/Applications/Gloomberb.app/Contents/Resources/gloomberb-tui/tui-entry.js"],
    )).toBeNull();
  });

  test("does not suggest Bun-managed updates for the bundled Windows app TUI runtime", () => {
    expect(detectUpdateAction(
      "C:\\Users\\vince\\AppData\\Local\\Programs\\Gloomberb\\bin\\bun.exe",
      [
        "C:\\Users\\vince\\AppData\\Local\\Programs\\Gloomberb\\bin\\bun.exe",
        "C:\\Users\\vince\\AppData\\Local\\Programs\\Gloomberb\\Resources\\gloomberb-tui\\tui-entry.js",
      ],
    )).toBeNull();
  });
});

describe("resolveSelfUpdateTargetPath", () => {
  it("rejects Bun runtime paths", () => {
    expect(resolveSelfUpdateTargetPath(
      "/Users/vince/.bun/bin/bun",
      ["/Users/vince/.bun/bin/bun", "src/index.tsx"],
    )).toBeNull();
  });

  it("rejects Node runtime paths", () => {
    expect(resolveSelfUpdateTargetPath(
      "/usr/local/bin/node",
      ["/usr/local/bin/node", "dist/index.js"],
    )).toBeNull();
  });

  it("rejects Windows Bun runtime paths", () => {
    expect(resolveSelfUpdateTargetPath(
      "C:\\Program Files\\Bun\\bun.exe",
      ["C:\\Program Files\\Bun\\bun.exe", "dist\\index.js"],
    )).toBeNull();
  });

  it("accepts packaged gloomberb binaries", () => {
    expect(resolveSelfUpdateTargetPath(
      "/Applications/gloomberb",
      ["/Applications/gloomberb"],
    )).toBe("/Applications/gloomberb");
  });

  it("rejects launchers inside macOS app bundles", () => {
    expect(resolveSelfUpdateTargetPath(
      "/Applications/Gloomberb.app/Contents/MacOS/launcher",
      ["/Applications/Gloomberb.app/Contents/MacOS/launcher"],
    )).toBeNull();
  });
});

describe("update host", () => {
  test("delegates update checks to an installed host", async () => {
    setUpdateHost({
      async checkForUpdateDetailed() {
        return {
          kind: "available",
          release: {
            version: "0.4.0",
            tagName: "v0.4.0",
            downloadUrl: "https://example.com/stable-macos-arm64-update.json",
            publishedAt: "",
            updateAction: { kind: "desktop" },
          },
        };
      },
      async performUpdate() {},
    });

    await expect(checkForUpdateDetailed("0.3.1")).resolves.toEqual({
      kind: "available",
      release: {
        version: "0.4.0",
        tagName: "v0.4.0",
        downloadUrl: "https://example.com/stable-macos-arm64-update.json",
        publishedAt: "",
        updateAction: { kind: "desktop" },
      },
    });
  });

  test("delegates update installation and progress to an installed host", async () => {
    const progress: UpdateProgress[] = [];
    const release: ReleaseInfo = {
      version: "0.4.0",
      tagName: "v0.4.0",
      downloadUrl: "https://example.com/stable-macos-arm64-update.json",
      publishedAt: "",
      updateAction: { kind: "desktop" },
    };

    setUpdateHost({
      async checkForUpdateDetailed() {
        return { kind: "current" };
      },
      async performUpdate(_release, onProgress) {
        onProgress({ phase: "downloading", percent: 50 });
        onProgress({ phase: "done", message: "Update installed, restarting..." });
      },
    });

    await performUpdate(release, (entry) => {
      progress.push(entry);
    });

    expect(progress).toEqual([
      { phase: "downloading", percent: 50 },
      { phase: "done", message: "Update installed, restarting..." },
    ]);
  });
});

describe("checkForUpdate", () => {
  it("skips update checks when running from source", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;

    try {
      Object.defineProperty(process, "execPath", { value: "/Users/vince/.bun/bin/bun", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Users/vince/.bun/bin/bun", "src/index.tsx"],
        configurable: true,
      });

      await expect(checkForUpdate("0.2.0")).resolves.toBeNull();
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });

  it("finds gzipped release assets published on GitHub", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.3.2",
      published_at: "2026-04-03T00:00:00Z",
      assets: [{
        name: expectedAssetName(true),
        browser_download_url: "https://example.com/gloomberb.gz",
        digest: `sha256:${"ab".repeat(32)}`,
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: "/Applications/gloomberb", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Applications/gloomberb"],
        configurable: true,
      });

      await expect(checkForUpdate("0.3.1")).resolves.toEqual({
        version: "0.3.2",
        tagName: "v0.3.2",
        downloadUrl: "https://example.com/gloomberb.gz",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        compressed: true,
        checksum: "ab".repeat(32),
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });
});

describe("checkForUpdateDetailed", () => {
  it("returns a useful error when GitHub rejects the request", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    globalThis.fetch = (async () => new Response("busy", { status: 503 })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: "/Applications/gloomberb", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Applications/gloomberb"],
        configurable: true,
      });

      await expect(checkForUpdateDetailed("0.3.1")).resolves.toEqual({
        kind: "error",
        error: "GitHub returned 503",
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });

  test.each([
    ["missing", undefined],
    ["malformed", "sha256:not-a-checksum"],
  ])("rejects release assets with a %s digest", async (_label, digest) => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.3.2",
      published_at: "2026-04-03T00:00:00Z",
      assets: [{
        name: expectedAssetName(),
        browser_download_url: "https://example.com/gloomberb",
        ...(digest ? { digest } : {}),
      }],
    }), { status: 200 })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: "/Applications/gloomberb", configurable: true });
      Object.defineProperty(process, "argv", { value: ["/Applications/gloomberb"], configurable: true });

      await expect(checkForUpdateDetailed("0.3.1")).resolves.toEqual({
        kind: "error",
        error: expect.stringContaining("valid SHA-256 digest"),
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });

  it("returns a clear Intel Mac error when no x64 asset exists", async () => {
    const restore = mockIntelMacRuntime();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.3.2",
      published_at: "2026-04-03T00:00:00Z",
      // Release ships only arm64 — no x64 asset for Intel Macs.
      assets: [{
        name: "gloomberb-darwin-arm64.gz",
        browser_download_url: "https://example.com/gloomberb-darwin-arm64.gz",
        digest: `sha256:${"ab".repeat(32)}`,
      }],
    }), { status: 200 })) as typeof fetch;

    try {
      await expect(checkForUpdateDetailed("0.3.1")).resolves.toEqual({
        kind: "error",
        error: "Intel Macs are not supported. Gloomberb currently ships Apple Silicon (arm64) only.",
      });
    } finally {
      restore();
    }
  });

  it("uses a real x64 asset when one exists for Intel Macs", async () => {
    const restore = mockIntelMacRuntime();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.3.2",
      published_at: "2026-04-03T00:00:00Z",
      assets: [{
        name: "gloomberb-darwin-x64.gz",
        browser_download_url: "https://example.com/gloomberb-darwin-x64.gz",
        digest: `sha256:${"cd".repeat(32)}`,
      }],
    }), { status: 200 })) as typeof fetch;

    try {
      const result = await checkForUpdateDetailed("0.3.1");
      expect(result.kind).toBe("available");
      if (result.kind === "available") {
        expect(result.release.downloadUrl).toBe("https://example.com/gloomberb-darwin-x64.gz");
        expect(result.release.checksum).toBe("cd".repeat(32));
      }
    } finally {
      restore();
    }
  });
});

describe("performUpdate", () => {
  it("returns a manual command instead of trying to overwrite Bun-managed installs", async () => {
    const progress: UpdateProgress[] = [];
    const release: ReleaseInfo = {
      version: "9.9.9",
      tagName: "v9.9.9",
      downloadUrl: "https://example.com/gloomberb-darwin-arm64",
      publishedAt: "2026-04-01T00:00:00Z",
      updateAction: { kind: "manual", command: "bun install -g gloomberb@latest" },
    };

    await performUpdate(release, (entry) => {
      progress.push(entry);
    });

    expect(progress).toEqual([
      {
        phase: "error",
        error: "Run bun install -g gloomberb@latest",
      },
    ]);
  });

  it("returns an explicit error instead of overwriting Bun when execution context changes", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    const progress: UpdateProgress[] = [];
    const release: ReleaseInfo = {
      version: "9.9.9",
      tagName: "v9.9.9",
      downloadUrl: "https://example.com/gloomberb-darwin-arm64",
      publishedAt: "2026-04-01T00:00:00Z",
      updateAction: { kind: "self" },
    };

    try {
      Object.defineProperty(process, "execPath", { value: "/Users/vince/.bun/bin/bun", configurable: true });
      Object.defineProperty(process, "argv", {
        value: ["/Users/vince/.bun/bin/bun", "src/index.tsx"],
        configurable: true,
      });

      await performUpdate(release, (entry) => {
        progress.push(entry);
      });

      expect(progress).toEqual([
        {
          phase: "error",
          error: "Self-update is unavailable when running from source or via Bun/Node. Relaunch the packaged gloomberb binary to update.",
        },
      ]);
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
    }
  });

  test.each([
    ["missing", undefined],
    ["malformed", "not-a-checksum"],
  ])("leaves the installed binary untouched when the checksum is %s", async (_label, checksum) => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    const tempDir = mkdtempSync(join(tmpdir(), "gloomberb-update-"));
    const execPath = join(tempDir, "gloomberb");
    const oldBinary = Buffer.from("old-binary");
    const progress: UpdateProgress[] = [];

    writeFileSync(execPath, oldBinary);
    chmodSync(execPath, 0o755);
    globalThis.fetch = (async () => new Response(gzipSync("new-binary"), { status: 200 })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
      Object.defineProperty(process, "argv", { value: [execPath], configurable: true });

      await performUpdate({
        version: "9.9.9",
        tagName: "v9.9.9",
        downloadUrl: "https://example.com/gloomberb.gz",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        compressed: true,
        ...(checksum ? { checksum } : {}),
      }, (entry) => { progress.push(entry); });

      expect(readFileSync(execPath)).toEqual(oldBinary);
      expect(progress.at(-1)).toEqual({
        phase: "error",
        error: "Self-update requires a valid SHA-256 checksum.",
      });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("replaces the binary when the downloaded asset checksum matches", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    const tempDir = mkdtempSync(join(tmpdir(), "gloomberb-update-"));
    const execPath = join(tempDir, "gloomberb");
    const nextBinary = Buffer.from("verified-binary");
    const checksum = createHash("sha256").update(nextBinary).digest("hex");
    const progress: UpdateProgress[] = [];

    writeFileSync(execPath, Buffer.from("old-binary"));
    chmodSync(execPath, 0o755);
    globalThis.fetch = (async () => new Response(nextBinary, { status: 200 })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
      Object.defineProperty(process, "argv", { value: [execPath], configurable: true });

      await performUpdate({
        version: "9.9.9",
        tagName: "v9.9.9",
        downloadUrl: "https://example.com/gloomberb",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        checksum,
      }, (entry) => { progress.push(entry); });

      expect(readFileSync(execPath)).toEqual(nextBinary);
      expect(progress.at(-1)).toEqual({ phase: "done" });
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("leaves the installed binary untouched when the checksum mismatches", async () => {
    const originalExecPath = process.execPath;
    const originalArgv = process.argv;
    const tempDir = mkdtempSync(join(tmpdir(), "gloomberb-update-"));
    const execPath = join(tempDir, "gloomberb");
    const oldBinary = Buffer.from("old-binary");
    const progress: UpdateProgress[] = [];

    writeFileSync(execPath, oldBinary);
    chmodSync(execPath, 0o755);
    globalThis.fetch = (async () => new Response("tampered", { status: 200 })) as typeof fetch;

    try {
      Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
      Object.defineProperty(process, "argv", { value: [execPath], configurable: true });

      await performUpdate({
        version: "9.9.9",
        tagName: "v9.9.9",
        downloadUrl: "https://example.com/gloomberb",
        publishedAt: "2026-04-03T00:00:00Z",
        updateAction: { kind: "self" },
        checksum: "00".repeat(32),
      }, (entry) => { progress.push(entry); });

      expect(readFileSync(execPath)).toEqual(oldBinary);
      expect(progress.at(-1)).toEqual(expect.objectContaining({
        phase: "error",
        error: expect.stringContaining("Checksum mismatch"),
      }));
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
      Object.defineProperty(process, "argv", { value: originalArgv, configurable: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
