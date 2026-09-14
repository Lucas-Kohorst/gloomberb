import type { PaneTemplateContext } from "../../../types/plugin";
import { parseFormsSetting } from "./forms";
import { secBrowserStatusCopy, secModule } from "./index";

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

test("ETF filings template filters fund registration forms", () => {
  const template = secModule.paneTemplates?.find((candidate) => candidate.id === "sec-etf-pane");
  const instance = template?.createInstance({} as PaneTemplateContext, { arg: "SPY" });

  expect(instance?.title).toBe("ETF SPY");
  expect(instance?.settings?.query).toBe("SPY");
  expect(String(instance?.settings?.forms)).toContain("485BPOS");
  expect(String(instance?.settings?.forms)).toContain("N-1A");
  expect(template?.shortcut?.prefix).toBe("ETF");
});

test("browser empty copy is specific; transport failures are not a generic dump", () => {
  const etfForms = parseFormsSetting(String(
    secModule.paneTemplates?.find((candidate) => candidate.id === "sec-etf-pane")
      ?.createInstance({} as PaneTemplateContext)
      ?.settings
      ?.forms,
  ));

  const latest = secBrowserStatusCopy({ query: "", forms: etfForms, error: null });
  expect(latest.error).toBe(false);
  expect(latest.title).toBe("No recent fund filings.");
  expect(latest.message).toContain("N-1A");
  expect(latest.message).toContain("485BPOS");
  expect(latest.message.toLowerCase()).toContain("ticker");

  const noHits = secBrowserStatusCopy({ query: "ZZZZ", forms: etfForms, error: "NO_DATA" });
  expect(noHits.error).toBe(false);
  expect(noHits.title).toContain("ZZZZ");
  expect(noHits.title).not.toContain("unavailable");

  const failed = secBrowserStatusCopy({
    query: "",
    forms: etfForms,
    error: "SEC request failed (403): blocked",
  });
  expect(failed.error).toBe(true);
  expect(failed.title).toBe("SEC EDGAR unavailable.");
  expect(failed.message).toContain("EDGAR");
  expect(failed.message).not.toBe("The data source is unavailable.");
  expect(failed.hint).toBe("Press r to retry.");
});
