import { expect, test } from "bun:test";
import { dataErrorMessage } from "./status";

test("maps provider reason codes to user-facing messages", () => {
  expect(dataErrorMessage("UPSTREAM_ERROR")).toBe("The data source is unavailable.");
  expect(dataErrorMessage("NO_DATA")).toBe("No data is available.");
  expect(dataErrorMessage("request failed: TIMEOUT")).toBe("The request timed out.");
  expect(dataErrorMessage("internal provider detail")).toBe("The data source is unavailable.");
});
