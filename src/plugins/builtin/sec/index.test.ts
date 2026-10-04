import { expect, test } from "bun:test";
import type { PaneTemplateContext } from "../../../types/plugin";
import { ETF_FORMS_SETTING } from "./forms";
import { secModule } from "./index";

test("ETF filings template filters fund registration forms", () => {
  const template = secModule.paneTemplates?.find((candidate) => candidate.shortcut?.prefix === "ETF");
  const instance = template?.createInstance?.({} as PaneTemplateContext, { arg: "SPY" });

  expect(instance && "settings" in instance ? instance.settings?.forms : undefined).toBe(ETF_FORMS_SETTING);
  expect(ETF_FORMS_SETTING).toContain("485BPOS");
  expect(ETF_FORMS_SETTING).toContain("N-1A");
  expect(template?.shortcut?.prefix).toBe("ETF");
});

test("default SEC template does not force the ETF form list", () => {
  const template = secModule.paneTemplates?.find((candidate) => candidate.shortcut?.prefix === "SEC");
  const instance = template?.createInstance?.({} as PaneTemplateContext, { arg: "AAPL" });
  const forms = instance && "settings" in instance ? instance.settings?.forms : undefined;

  expect(template?.shortcut?.prefix).toBe("SEC");
  expect(forms).toBeUndefined();
  expect(String(forms ?? "")).not.toContain("485BPOS");
  expect(String(forms ?? "")).not.toContain("N-1A");
});
