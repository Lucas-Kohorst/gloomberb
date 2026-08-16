import type { PaneTemplateContext } from "../../../types/plugin";
import { secModule } from "./index";

test("creates a standalone instance without ticker context", () => {
  const template = secModule.paneTemplates?.find((candidate) => candidate.id === "sec-pane");
  const instance = template?.createInstance({} as PaneTemplateContext);

  expect(instance?.binding).toEqual({ kind: "none" });
});
