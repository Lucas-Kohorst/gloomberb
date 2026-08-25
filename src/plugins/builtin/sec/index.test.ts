import type { PaneTemplateContext } from "../../../types/plugin";
import { secModule } from "./index";

test("creates a standalone instance without ticker context", () => {
  const template = secModule.paneTemplates?.find((candidate) => candidate.id === "sec-pane");
  const instance = template?.createInstance({} as PaneTemplateContext);

  expect(instance?.binding).toEqual({ kind: "none" });
});

test("10-K / 10-Q template filters periodic reports", () => {
  const template = secModule.paneTemplates?.find((candidate) => candidate.id === "sec-10k-pane");
  const instance = template?.createInstance({} as PaneTemplateContext, { arg: "AAPL" });

  expect(instance?.settings).toEqual({
    query: "AAPL",
    forms: "10-K,10-Q,10-K/A,10-Q/A",
  });
  expect(instance?.title).toBe("10-K/Q AAPL");
  expect(template?.shortcut?.prefix).toBe("10K");
});
