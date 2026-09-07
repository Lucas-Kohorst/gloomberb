import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "gloom-deploy-test-"));
const curl = join(directory, "curl");
writeFileSync(curl, `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.some(arg => arg.includes("api.cloudflare.com"))) {
  console.log(JSON.stringify({ success: true, result: [{
    hostname: "terminal.kohor.st",
    service: process.env.TEST_SERVICE ?? "gloomberb-web",
    environment: "production",
  }] }));
} else {
  if (process.env.TEST_TRANSPORT) process.exit(28);
  await Bun.write(args[args.indexOf("--output") + 1], process.env.TEST_BODY ?? '{"status":"ok"}');
  process.stdout.write(process.env.TEST_STATUS ?? "200");
}
`);
chmodSync(curl, 0o755);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test.each([
  ["healthy", {}, true],
  ["blocked health probe", { TEST_STATUS: "403" }, true],
  ["server failure", { TEST_STATUS: "500" }, false],
  ["missing endpoint", { TEST_STATUS: "404" }, false],
  ["transport failure", { TEST_TRANSPORT: "1" }, false],
  ["invalid health body", { TEST_BODY: "{}" }, false],
  ["wrong worker", { TEST_SERVICE: "old-worker" }, false],
] as const)("deployment verification: %s", (_name, environment, succeeds) => {
  const result = Bun.spawnSync(["bash", join(import.meta.dir, "verify-cloudflare-deploy.sh")], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CLOUDFLARE_ACCOUNT_ID: "fixture",
      CLOUDFLARE_API_TOKEN: "fixture",
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode === 0).toBe(succeeds);
  if ("TEST_STATUS" in environment && environment.TEST_STATUS === "403") {
    expect(new TextDecoder().decode(result.stdout)).toContain("::warning::");
  }
});
