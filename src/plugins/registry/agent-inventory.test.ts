import { describe, expect, test } from "bun:test";
import { missingAgentVisibleDescriptions } from "./agent-inventory";

function command(
  id: string,
  options: { description?: string; hidden?: boolean } = {},
) {
  return {
    id,
    description: options.description,
    hidden: options.hidden === undefined ? undefined : () => options.hidden!,
  };
}

function template(id: string, description: string) {
  return { id, description };
}

describe("missingAgentVisibleDescriptions", () => {
  test("reports visible commands without a trimmed description", () => {
    const result = missingAgentVisibleDescriptions({
      commands: new Map([
        ["visible-ok", command("visible-ok", { description: "Opens the pane" })],
        ["visible-missing", command("visible-missing")],
        ["visible-empty", command("visible-empty", { description: "" })],
        ["visible-blank", command("visible-blank", { description: "   " })],
      ]),
      paneTemplates: new Map(),
    });

    expect(result.commands).toEqual(["visible-blank", "visible-empty", "visible-missing"]);
    expect(result.templates).toEqual([]);
  });

  test("ignores hidden commands even when the description is missing", () => {
    const result = missingAgentVisibleDescriptions({
      commands: new Map([
        ["hidden-missing", command("hidden-missing", { hidden: true })],
        ["hidden-blank", command("hidden-blank", { description: "  ", hidden: true })],
        ["visible-missing", command("visible-missing")],
      ]),
      paneTemplates: new Map(),
    });

    expect(result.commands).toEqual(["visible-missing"]);
  });

  test("reports templates without a trimmed description", () => {
    const result = missingAgentVisibleDescriptions({
      commands: new Map(),
      paneTemplates: new Map([
        ["ok", template("ok", "A useful pane")],
        ["missing-empty", template("missing-empty", "")],
        ["missing-blank", template("missing-blank", " \t ")],
      ]),
    });

    expect(result.templates).toEqual(["missing-blank", "missing-empty"]);
    expect(result.commands).toEqual([]);
  });

  test("returns empty arrays when every visible entry has a description", () => {
    const result = missingAgentVisibleDescriptions({
      commands: new Map([
        ["open", command("open", { description: "Open" })],
        ["secret", command("secret", { hidden: true })],
      ]),
      paneTemplates: new Map([
        ["news", template("news", "News")],
      ]),
    });

    expect(result).toEqual({ commands: [], templates: [] });
  });
});
