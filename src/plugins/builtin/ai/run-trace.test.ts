import { afterEach, describe, expect, test } from "bun:test";
import { getAiRunsDir, setAiRunsDirForTests } from "./run-trace";

const ENV_KEY = "GLOOMBERB_DATA_DIR";

afterEach(() => {
  delete process.env[ENV_KEY];
  setAiRunsDirForTests(null);
});

describe("getAiRunsDir", () => {
  test("resolves under GLOOMBERB_DATA_DIR when set", () => {
    process.env[ENV_KEY] = "/tmp/isolated-data";
    setAiRunsDirForTests(null);
    expect(getAiRunsDir()).toBe("/tmp/isolated-data/ai-runs");
  });

  test("falls back to ~/.gloomberb/ai-runs when GLOOMBERB_DATA_DIR is unset", () => {
    delete process.env[ENV_KEY];
    setAiRunsDirForTests(null);
    const dir = getAiRunsDir();
    expect(dir).toMatch(/\.gloomberb[/\\]ai-runs$/);
    expect(dir).not.toContain("GLOOMBERB_DATA_DIR");
  });

  test("test override takes precedence over GLOOMBERB_DATA_DIR", () => {
    process.env[ENV_KEY] = "/tmp/isolated-data";
    setAiRunsDirForTests("/tmp/override");
    expect(getAiRunsDir()).toBe("/tmp/override");
  });

  test("picks up GLOOMBERB_DATA_DIR change after cache reset", () => {
    process.env[ENV_KEY] = "/tmp/first";
    setAiRunsDirForTests(null);
    expect(getAiRunsDir()).toBe("/tmp/first/ai-runs");

    // Simulate a new session with a different data dir.
    process.env[ENV_KEY] = "/tmp/second";
    setAiRunsDirForTests(null);
    expect(getAiRunsDir()).toBe("/tmp/second/ai-runs");
  });
});
