import { describe, expect, test } from "bun:test";
import { confirmPluginInstall } from "./confirm";

describe("confirmPluginInstall", () => {
  test("approves immediately when --yes is set", async () => {
    expect(await confirmPluginInstall({
      ref: "attacker/widgets",
      approved: true,
      interactive: false,
    })).toBe(true);
  });

  test("fails closed when not interactive and no --yes", async () => {
    // Agent/scripted dispatch (JSON/CSV/NDJSON, non-TTY stdin): no prompt,
    // no install.
    expect(await confirmPluginInstall({
      ref: "attacker/widgets",
      approved: false,
      interactive: false,
    })).toBe(false);
  });

  test("asks the prompt when interactive and follows the answer", async () => {
    let asked: string | null = null;
    const prompt = async (question: string) => {
      asked = question;
      return true;
    };
    expect(await confirmPluginInstall({
      ref: "owner/repo",
      approved: false,
      interactive: true,
      prompt,
    })).toBe(true);
    expect(asked).toContain("owner/repo");
    expect(asked).toContain("runs the plugin's code");
  });

  test("refuses when the interactive answer is negative", async () => {
    expect(await confirmPluginInstall({
      ref: "attacker/widgets",
      approved: false,
      interactive: true,
      prompt: async () => false,
    })).toBe(false);
  });
});
