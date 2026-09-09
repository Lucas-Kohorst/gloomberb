import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalWebClient } from "./server";

// The local web client is an owner-level loopback bridge. Closing its trust
// boundary must not regress: foreign Host headers must be refused (DNS
// rebinding) and resetAllData must not delete a caller-selected directory.

let baseDir: string;
let dataDir: string;
let publicDir: string;
let client!: Awaited<ReturnType<typeof startLocalWebClient>>;

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "gloomberb-web-server-"));
  dataDir = join(baseDir, "data");
  publicDir = join(baseDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(
    join(publicDir, "index.html"),
    '<html><body><script>window.__GLOOM_WEB_SESSION = "test-session-token";</script></body></html>',
  );
  process.env.GLOOMBERB_DATA_DIR = dataDir;
  client = await startLocalWebClient({ publicDir });
});

afterAll(async () => {
  client?.stop();
  delete process.env.GLOOMBERB_DATA_DIR;
  await rm(baseDir, { recursive: true, force: true });
});

/** Send a raw HTTP/1.1 request so the Host header can be forged like a browser
 * under DNS rebinding would. Returns the full response text. */
function rawRequest(
  port: number,
  hostHeader: string,
  options: { method?: string; path?: string; body?: string; extraHeaders?: string[] } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let raw = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(raw));
    const headerLines = [
      `${options.method ?? "GET"} ${options.path ?? "/"} HTTP/1.1`,
      `Host: ${hostHeader}`,
      "Connection: close",
      ...(options.body !== undefined ? [`Content-Length: ${Buffer.byteLength(options.body)}`] : []),
      ...(options.extraHeaders ?? []),
    ];
    socket.write(`${headerLines.join("\r\n")}\r\n\r\n${options.body ?? ""}`);
    socket.end();
  });
}

test("serves assets only for loopback Host headers", async () => {
  const port = Number(new URL(client.url).port);

  const ip = await rawRequest(port, `127.0.0.1:${port}`);
  expect(ip.startsWith("HTTP/1.1 200")).toBe(true);
  expect(ip).toContain("test-session-token");

  const localhost = await rawRequest(port, `localhost:${port}`);
  expect(localhost.startsWith("HTTP/1.1 200")).toBe(true);
});

test("refuses requests with a foreign or missing Host header", async () => {
  const port = Number(new URL(client.url).port);

  const foreign = await rawRequest(port, "attacker.example:9999");
  expect(foreign.startsWith("HTTP/1.1 403")).toBe(true);
  expect(foreign).not.toContain("test-session-token");

  const missingHost = await rawRequest(port, "");
  expect(missingHost.startsWith("HTTP/1.1 403")).toBe(true);
});

test("refuses a token-bearing RPC when the Host header is not loopback", async () => {
  const port = Number(new URL(client.url).port);
  const raw = await rawRequest(port, "attacker.example:9999", {
    method: "POST",
    path: "/_gloomberb/rpc",
    body: JSON.stringify({ method: "init", payload: {} }),
    extraHeaders: ["Authorization: Bearer test-session-token"],
  });
  expect(raw.startsWith("HTTP/1.1 403")).toBe(true);
});

test("config.resetAllData refuses a directory outside the active data directory", async () => {
  const victim = await mkdtemp(join(tmpdir(), "gloomberb-web-victim-"));
  const marker = join(victim, "keep.txt");
  await writeFile(marker, "do not delete");
  try {
    const response = await fetch(`${client.url}/_gloomberb/rpc`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ method: "config.resetAllData", payload: { dataDir: victim } }),
    });
    expect(response.status).toBe(400);
    expect(await readFile(marker, "utf8")).toBe("do not delete");
  } finally {
    await rm(victim, { recursive: true, force: true });
  }
});

test("config.resetAllData still resets the active data directory", async () => {
  expect(existsSync(join(dataDir, "config.json"))).toBe(true);
  const response = await fetch(`${client.url}/_gloomberb/rpc`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-session-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ method: "config.resetAllData", payload: { dataDir } }),
  });
  expect(response.status).toBe(200);
  expect(existsSync(dataDir)).toBe(false);
});
