import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  estimateTokens,
  formatTracedError,
  previewText,
  setAiRunsDirForTests,
  writeAiRunPromptFile,
  writeAiRunTrace,
} from "./run-trace";

describe("AI run traces", () => {
  afterEach(() => {
    setAiRunsDirForTests(null);
  });

  test("writes the prompt and a last.json record with sizes", () => {
    const dir = mkdtempSync(join(tmpdir(), "gloomberb-ai-runs-"));
    setAiRunsDirForTests(dir);
    const promptPath = writeAiRunPromptFile("run-1", "hello plugin");
    const lastPath = writeAiRunTrace({
      id: "run-1",
      timestamp: 1,
      providerId: "factory",
      promptChars: 12,
      estimatedTokens: estimateTokens("hello plugin"),
      promptPreview: previewText("hello plugin"),
      durationMs: 5,
      files: { prompt: promptPath },
    });
    expect(readFileSync(promptPath, "utf8")).toBe("hello plugin");
    const last = JSON.parse(readFileSync(lastPath, "utf8")) as { providerId: string; promptChars: number };
    expect(last).toMatchObject({ providerId: "factory", promptChars: 12 });
    expect(estimateTokens("abcd")).toBe(1);
  });

  test("overflow errors point at the trace file", () => {
    const error = formatTracedError(
      new Error('OpenAI API error (400): "This model\'s maximum prompt length is 500000 but the request is 538102 tokens."'),
      "/tmp/ai-runs/last.json",
    );
    expect(error.message).toContain("Prompt exceeded the model window");
    expect(error.message).toContain("/tmp/ai-runs/last.json");
  });
});
