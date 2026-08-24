import { expect, test } from "bun:test";
import type { PaneTemplateContext, PaneTemplateCreateOptions } from "../../../types/plugin";
import { listConnectionSources } from "../connections/register";
import { earningsTranscriptsModule } from "./index";

const template = earningsTranscriptsModule.paneTemplates?.find(
  (t) => t.id === "earnings-transcripts-pane",
);

test("registers the earnings-transcripts pane template", () => {
  expect(template).toBeDefined();
  expect(template?.paneId).toBe("earnings-transcripts");
  expect(template?.shortcut?.prefix).toBe("TRANS");
  expect(template?.shortcut?.argKind).toBe("ticker");
});

test("creates a floating instance with ticker query from arg", () => {
  const context = {} as PaneTemplateContext;
  const options = { arg: "AAPL" } as PaneTemplateCreateOptions;
  const instance = template?.createInstance(context, options);

  expect(instance).not.toBeNull();
  expect(instance?.title).toBe("TRANS AAPL");
  expect(instance?.placement).toBe("floating");
  expect(instance?.binding).toEqual({ kind: "none" });
  expect(instance?.settings).toEqual({ query: "AAPL" });
  expect(instance?.instanceId).toBe("earnings-transcripts:AAPL");
});

test("creates a latest instance when no arg is provided", () => {
  const context = {} as PaneTemplateContext;
  const instance = template?.createInstance(context, undefined);

  expect(instance).not.toBeNull();
  expect(instance?.title).toBe("Earnings Transcripts");
  expect(instance?.instanceId).toBe("earnings-transcripts:latest");
});

test("creates an instance with a symbol from options", () => {
  const context = {} as PaneTemplateContext;
  const options = { symbol: "MSFT" } as PaneTemplateCreateOptions;
  const instance = template?.createInstance(context, options);

  expect(instance).not.toBeNull();
  expect(instance?.title).toBe("TRANS MSFT");
  expect(instance?.settings).toEqual({ query: "MSFT" });
});

// Hosted/web disables capability invoke handlers, so a source that is only
// listed in `plugin.capabilities` never shows up in the Connections pane. This
// pins the real registry rather than a stubbed context method.
test("publishes an earnings-transcripts source to the connection registry", () => {
  const ctx = {
    registerTickerResearchTab: () => {},
  } as unknown as Parameters<NonNullable<typeof earningsTranscriptsModule.setup>>[0];

  earningsTranscriptsModule.setup?.(ctx);
  expect(listConnectionSources().map((source) => source.id)).toContain("earnings-transcripts");

  earningsTranscriptsModule.dispose?.();
  expect(listConnectionSources().map((source) => source.id)).not.toContain("earnings-transcripts");
});
