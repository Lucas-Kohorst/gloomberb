import { describe, expect, test } from "bun:test";
import { summarizeSearchFailures } from "./data";

describe("summarizeSearchFailures", () => {
  test("names the provider that failed beside successful hits", () => {
    const failure = summarizeSearchFailures(
      [
        { status: "fulfilled", value: { hits: [1] } },
        { status: "rejected", reason: new Error("Adjacent 502") },
      ],
      ["Gloom Cloud", "CFTC filings"],
    );
    expect(failure).toEqual({
      message: "Adjacent 502",
      label: "CFTC filings error",
    });
  });

  test("ignores aborted requests from a superseded query", () => {
    const abort = new Error("Aborted");
    abort.name = "AbortError";
    expect(summarizeSearchFailures(
      [{ status: "rejected", reason: abort }],
      ["Gloom Cloud"],
    )).toBeNull();
  });

  test("counts when more than one source fails", () => {
    const failure = summarizeSearchFailures(
      [
        { status: "rejected", reason: new Error("cloud down") },
        { status: "rejected", reason: new Error("cftc down") },
      ],
      ["Gloom Cloud", "CFTC filings"],
    );
    expect(failure?.label).toBe("2 source errors");
    expect(failure?.message).toBe("Gloom Cloud, CFTC filings");
  });
});
