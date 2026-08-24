import { describe, expect, test } from "bun:test";
import {
  buildScreenerPrompt,
  getScreenerPromptSignature,
  matchesScreenerPromptSignature,
  parseScreenerResponse,
} from "./contract";

describe("AI screener helpers", () => {
  test("includes the model override in run identity", () => {
    expect(getScreenerPromptSignature("quality", "codex", "gpt-a"))
      .not.toBe(getScreenerPromptSignature("quality", "codex", "gpt-b"));
    expect(getScreenerPromptSignature("quality", "codex", ""))
      .toBe(getScreenerPromptSignature("quality", "codex", null));
    expect(matchesScreenerPromptSignature(
      JSON.stringify(["codex", "quality"]),
      "quality",
      "codex",
      null,
    )).toBe(true);
    expect(matchesScreenerPromptSignature(
      JSON.stringify(["codex", "quality"]),
      "quality",
      "codex",
      "gpt-custom",
    )).toBe(false);
  });

  test("builds a fresh screener prompt with the current date", () => {
    const prompt = buildScreenerPrompt({
      currentDate: "2026-04-01",
      prompt: "Find profitable serial acquirers.",
    });

    expect(prompt).toContain("Today is 2026-04-01.");
    expect(prompt).toContain("Use the available Gloomberb data tools");
    expect(prompt).toContain("Reply with ONLY a JSON object");
    expect(prompt).toContain('"tickers"');
    expect(prompt).not.toContain("already found");
    expect(prompt).not.toContain("Prefer new names");
    expect(prompt).not.toContain("CLI");
  });

  test("parses fenced JSON responses and normalizes ticker fields", () => {
    const parsed = parseScreenerResponse(`
\`\`\`json
{
  "title": "Compounders",
  "summary": "High quality names",
  "tickers": [
    { "symbol": " msft ", "exchange": " nasdaq ", "reason": "Recurring software cash flow" }
  ]
}
\`\`\`
`);

    expect(parsed).toEqual({
      title: "Compounders",
      summary: "High quality names",
      tickers: [
        {
          symbol: "MSFT",
          exchange: "NASDAQ",
          reason: "Recurring software cash flow",
        },
      ],
    });
  });

  test("parses a top-level JSON ticker array from small models", () => {
    const parsed = parseScreenerResponse(`
Here are some names:
[{"ticker":"tsla","reason":"Optimus humanoid robots"},{"symbol":"NVDA","exchange":"NASDAQ","reason":"AI chips in humanoid stacks"}]
`);
    expect(parsed.tickers.map((ticker) => ticker.symbol)).toEqual(["TSLA", "NVDA"]);
    expect(parsed.tickers[0]?.reason).toContain("Optimus");
  });

  test("parses a bullet list when the model ignores JSON", () => {
    const parsed = parseScreenerResponse(`
TSLA (NASDAQ): Builds Optimus humanoid robots
NVDA - supplies AI compute for humanoid platforms
`);
    expect(parsed.tickers.map((ticker) => ticker.symbol)).toEqual(["TSLA", "NVDA"]);
    expect(parsed.tickers[0]?.exchange).toBe("NASDAQ");
  });

});
