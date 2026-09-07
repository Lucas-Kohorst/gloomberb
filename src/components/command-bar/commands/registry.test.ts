import { describe, expect, test } from "bun:test";
import {
  applyTickerSearchShortcutConfig,
  commands,
  getCommandPrefixes,
  matchPrefix,
} from "./registry";

function securityDescription(commandList = commands) {
  const command = commandList.find((entry) => entry.id === "security-description");
  if (!command) throw new Error("security-description command missing");
  return command;
}

describe("applyTickerSearchShortcutConfig", () => {
  test("keeps the command list untouched without a configured shortcut", () => {
    const result = applyTickerSearchShortcutConfig(commands, undefined);
    expect(result).toEqual(commands);
    expect(securityDescription(result).prefix).toBe("DES");
    expect(securityDescription(result).aliases).toEqual(["T"]);
  });

  test("adds the configured shortcut as an extra prefix while keeping DES and T", () => {
    const result = applyTickerSearchShortcutConfig(commands, "TS");
    const prefixes = getCommandPrefixes(securityDescription(result));
    expect(new Set(prefixes)).toEqual(new Set(["DES", "T", "TS"]));
    expect(securityDescription(result).prefix).toBe("DES");
  });

  test("normalizes case and surrounding whitespace", () => {
    const result = applyTickerSearchShortcutConfig(commands, "  ts ");
    expect(getCommandPrefixes(securityDescription(result))).toContain("TS");
  });

  test("ignores invalid values (empty, whitespace, too long, non-alphanumeric)", () => {
    for (const invalid of ["", "   ", "a b", "TOO-LONG-123", "T!CK", "TS!ML"]) {
      expect(applyTickerSearchShortcutConfig(commands, invalid)).toEqual(commands);
    }
  });

  test("ignores values that collide with another built-in command prefix", () => {
    for (const colliding of ["AW", "T", "DES", "HELP", "win"]) {
      expect(applyTickerSearchShortcutConfig(commands, colliding)).toEqual(commands);
    }
  });

  test("ignores values that collide with a reserved pane or plugin prefix", () => {
    const result = applyTickerSearchShortcutConfig(commands, "EE", { reservedPrefixes: ["ee", "PLUG"] });
    expect(result).toEqual(commands);
  });

  test("allows a longer shortcut that extends ticker search's built-in T prefix", () => {
    const result = applyTickerSearchShortcutConfig(commands, "TS", { reservedPrefixes: ["T"] });
    expect(getCommandPrefixes(securityDescription(result))).toContain("TS");
  });

  test("leaves every other command unchanged", () => {
    const result = applyTickerSearchShortcutConfig(commands, "TS");
    for (const command of commands) {
      if (command.id === "security-description") continue;
      expect(result.find((candidate) => candidate.id === command.id)).toEqual(command);
    }
  });
});

describe("matchPrefix with a configured ticker-search shortcut", () => {
  test("matches the custom prefix with an argument", () => {
    const effective = applyTickerSearchShortcutConfig(commands, "GO");
    const match = matchPrefix("GO AAPL", effective);
    expect(match?.command.id).toBe("security-description");
    expect(match?.arg).toBe("AAPL");
  });

  test("keeps matching DES and T after customization", () => {
    const effective = applyTickerSearchShortcutConfig(commands, "GO");
    expect(matchPrefix("DES AAPL", effective)?.command.id).toBe("security-description");
    expect(matchPrefix("T AAPL", effective)?.command.id).toBe("security-description");
  });

  test("does not steal another command's prefix when the value would have collided", () => {
    const effective = applyTickerSearchShortcutConfig(commands, "AW");
    const match = matchPrefix("AW NVDA", effective);
    expect(match?.command.id).toBe("add-watchlist");
  });
});
