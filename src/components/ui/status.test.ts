import { expect, test } from "bun:test";
import {
  dataErrorMessage,
  footerErrorChip,
  isNoDataError,
  noDataMessage,
  noDataTitle,
  unavailableTitle,
} from "./status";

test("maps provider reason codes to user-facing messages", () => {
  expect(dataErrorMessage("UPSTREAM_ERROR")).toBe("The data source is unavailable.");
  expect(dataErrorMessage("NO_DATA")).toBe("No data is available.");
  expect(dataErrorMessage("request failed: TIMEOUT")).toBe("The request timed out.");
  expect(dataErrorMessage("internal provider detail")).toBe("The data source is unavailable.");
});

test("treats empty provider results as no-data, not transport failures", () => {
  expect(isNoDataError("NO_DATA")).toBe(true);
  expect(isNoDataError("No analyst data for ZCSH")).toBe(true);
  expect(isNoDataError("No dividend data found for ZCSH")).toBe(true);
  expect(isNoDataError("No options available.")).toBe(true);
  expect(isNoDataError("The request timed out.")).toBe(false);
  expect(isNoDataError("UPSTREAM_ERROR")).toBe(false);
});

test("builds the centered two-line empty copy", () => {
  expect(noDataTitle("ESG")).toBe("No ESG data");
  expect(noDataMessage("ZCSH", "Yahoo ESG scores")).toBe("ZCSH has no Yahoo ESG scores.");
  expect(unavailableTitle("analyst")).toBe("Analyst data unavailable");
  expect(unavailableTitle("ESG")).toBe("ESG data unavailable");
});

test("keeps no-data copy out of the footer", () => {
  expect(footerErrorChip("No dividend data found for ZCSH")).toBeNull();
  expect(footerErrorChip("UPSTREAM_ERROR")).toEqual({ text: "unavailable", tone: "warning" });
});
