import { describe, expect, test } from "bun:test";
import type { Context } from "@earendil-works/pi-ai";
import { homedir } from "os";
import {
  buildDroidExecArgs,
  createFactoryProvider,
  extractPrompt,
  FACTORY_AGENT_SYSTEM_PROMPT,
  parseDroidExecOutput,
} from "./provider";
import { FACTORY_AUTH_PATH, FACTORY_WORKDIR, LOCAL_DROID_PATH } from "./detect";

function context(messages: Context["messages"], systemPrompt?: string): Context {
  return { systemPrompt, messages };
}

describe("Factory droid-exec provider", () => {
  test("tells the agent to create layouts without layout.open", () => {
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("layout.new");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("layout.new creates and switches to the named desk");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("Do not use layout.open");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("Batch uses requests (plural)");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).not.toMatch(/operation":"layout\.open"/);
  });

  test("teaches themed layout.new with panes across multiple themes, not name-only", () => {
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain('"panes":["polls","congress-trades","adjacent-indices","prediction-markets","news-firehose"]');
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain('"panes":["portfolio-list","ticker-research","market-movers","fear-greed","sectors"]');
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain('"panes":["econ-calendar","yield-curve","world-indices","treasury-auctions","federal-register","news-firehose"]');
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain('"panes":["news-firehose","news-top-pane","substack-pane","macro-tv-pane","twitter-feed-pane"]');
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("app://pane-templates");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).not.toMatch(/layout\.new","input":\{"name":"Democrats"\}/);
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("Do not use layout.open");
  });

  test("teaches seeded chart-composer-pane, not empty pane.show chart-composer", () => {
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("chart-composer-pane");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain('"arg":"POLY:fed-cut-september, FRED:FEDFUNDS"');
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("pane.show chart-composer is empty");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).not.toMatch(/pane\.show","input":\{"paneId":"chart-composer"\}/);
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("cftc-filings-pane");
    expect(FACTORY_AGENT_SYSTEM_PROMPT).toContain("registerAgentPromptFragment");
  });

  test("builds a Pi provider with ambient droid auth and curated models", () => {
    const provider = createFactoryProvider();
    expect(provider.id).toBe("factory");
    expect(provider.name).toBe("Factory");
    expect(provider.auth.apiKey?.name).toBe("Factory Droid");
    expect(provider.getModels().map((model) => model.id)).toContain("claude-opus-5");
    expect(provider.getModels().map((model) => model.id)).toContain("claude-sonnet-5");
  });

  test("checks the expanded droid auth path, not a tilde path", async () => {
    const provider = createFactoryProvider();
    const seen: string[] = [];
    await provider.auth.apiKey?.check?.({
      ctx: {
        env: async () => undefined,
        fileExists: async (path) => {
          seen.push(path);
          return false;
        },
      },
    } as never);
    expect(seen).toContain(LOCAL_DROID_PATH);
    expect(seen).toContain(FACTORY_AUTH_PATH);
    expect(FACTORY_AUTH_PATH.startsWith(homedir())).toBe(true);
    expect(seen.some((path) => path.startsWith("~"))).toBe(false);
  });

  test("joins system prompt and conversation text for droid exec", () => {
    expect(extractPrompt(context([]))).toBe("");
    expect(extractPrompt(context([
      { role: "user", content: "hello", timestamp: 1 },
    ]))).toBe("hello");
    expect(extractPrompt(context([
      { role: "user", content: [{ type: "text", text: "first" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
        api: "pi-messages",
        provider: "factory",
        model: "claude-sonnet-5",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      },
      { role: "user", content: "third", timestamp: 3 },
    ], "Be brief"))).toBe("Be brief\n\nfirst\n\nAssistant: second\n\nthird");
  });

  test("parses droid exec JSON and falls back to raw stdout", () => {
    expect(parseDroidExecOutput(
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
      "",
    )).toBe("ok");
    expect(parseDroidExecOutput("plain text", "")).toBe("plain text");
    expect(() => parseDroidExecOutput(
      JSON.stringify({ type: "result", is_error: true, result: "nope" }),
      "",
    )).toThrow("nope");
    expect(() => parseDroidExecOutput("", "spawn failed")).toThrow("spawn failed");
  });

  test("runs droid in the plugins directory with file writes enabled", () => {
    expect(FACTORY_WORKDIR).toContain(".gloomberb/plugins");
    expect(buildDroidExecArgs("grok-4.6", "/tmp/prompt.txt", FACTORY_WORKDIR)).toEqual([
      "exec",
      "--output-format", "json",
      "--auto", "low",
      "--disable-builtin-skills",
      "--cwd", FACTORY_WORKDIR,
      "-m", "grok-4.6",
      "-f", "/tmp/prompt.txt",
    ]);
  });

  test("truncates a huge conversation instead of sending the whole repo-sized prompt", () => {
    const huge = "x".repeat(80_000);
    const prompt = extractPrompt(context([
      { role: "user", content: huge, timestamp: 1 },
      { role: "user", content: huge, timestamp: 2 },
      { role: "user", content: "latest", timestamp: 3 },
    ], "Stay in plugins."));
    expect(prompt).toContain("Stay in plugins.");
    expect(prompt).toContain("latest");
    expect(prompt).toContain("truncated");
    expect(prompt.length).toBeLessThan(130_000);
  });
});
