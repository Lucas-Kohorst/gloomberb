import { afterEach, describe, expect, test } from "bun:test";
import { applyDataDirFromArgs, parseCliGlobalArgs } from "./options";

const ENV_KEY = "GLOOMBERB_DATA_DIR";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("applyDataDirFromArgs", () => {
  test("sets GLOOMBERB_DATA_DIR from --data-dir <value>", () => {
    applyDataDirFromArgs(["--data-dir", "/tmp/test-data"]);
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
  });

  test("sets GLOOMBERB_DATA_DIR from --data-dir=<value>", () => {
    applyDataDirFromArgs(["--data-dir=/tmp/test-data"]);
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
  });

  test("does NOT set GLOOMBERB_DATA_DIR when next arg is a flag", () => {
    applyDataDirFromArgs(["--data-dir", "--headless"]);
    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  test("does NOT set GLOOMBERB_DATA_DIR when --data-dir is last arg", () => {
    applyDataDirFromArgs(["--data-dir"]);
    expect(process.env[ENV_KEY]).toBeUndefined();
  });
});

describe("parseCliGlobalArgs", () => {
  test("extracts global output and execution flags anywhere before --", () => {
    const parsed = parseCliGlobalArgs([
      "quote",
      "--json",
      "AAPL",
      "--limit",
      "2",
      "--refresh",
      "--dry-run",
      "--yes",
      "--no-color",
    ]);

    expect(parsed.args).toEqual(["quote", "AAPL"]);
    expect(parsed.options).toMatchObject({
      format: "json",
      limit: 2,
      refresh: true,
      dryRun: true,
      yes: true,
      color: false,
    });
  });

  test("leaves arguments after -- untouched", () => {
    const parsed = parseCliGlobalArgs(["ai", "ask", "--", "--json"]);
    expect(parsed.args).toEqual(["ai", "ask", "--json"]);
    expect(parsed.options.format).toBe("text");
  });

  test("rejects invalid limits", () => {
    expect(() => parseCliGlobalArgs(["quote", "AAPL", "--limit=0"])).toThrow("--limit");
  });

  test("throws on missing --data-dir value", () => {
    expect(() => parseCliGlobalArgs(["--data-dir"])).toThrow("Missing value for --data-dir.");
  });

  test("sets dataDir and GLOOMBERB_DATA_DIR from --data-dir <value>", () => {
    delete process.env[ENV_KEY];
    const result = parseCliGlobalArgs(["--data-dir", "/tmp/test-data"]);
    expect(result.options.dataDir).toBe("/tmp/test-data");
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
    delete process.env[ENV_KEY];
  });

  test("sets dataDir and GLOOMBERB_DATA_DIR from --data-dir=<value>", () => {
    delete process.env[ENV_KEY];
    const result = parseCliGlobalArgs(["--data-dir=/tmp/test-data"]);
    expect(result.options.dataDir).toBe("/tmp/test-data");
    expect(process.env[ENV_KEY]).toBe("/tmp/test-data");
    delete process.env[ENV_KEY];
  });
});
