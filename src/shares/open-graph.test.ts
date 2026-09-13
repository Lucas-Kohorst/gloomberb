import { describe, expect, test } from "bun:test";
import { injectShareDocumentMeta } from "./open-graph";

describe("share open graph", () => {
  test("injects title and description into the share document", () => {
    const html = injectShareDocumentMeta(
      "<!doctype html><html><head><title>Gloomberb</title></head><body></body></html>",
      {
        title: "BRIEF-Situational Awareness <CNBC>",
        description: "Sept 11 (Reuters) - SITUATIONAL AWARENESS ACTIVE IN OPTIONS MARKET",
      },
    );
    expect(html).toContain("<title>BRIEF-Situational Awareness &lt;CNBC&gt;</title>");
    expect(html).toContain('property="og:title"');
    expect(html).toContain("BRIEF-Situational Awareness &lt;CNBC&gt;");
    expect(html).toContain('property="og:description"');
    expect(html).toContain("SITUATIONAL AWARENESS ACTIVE IN OPTIONS MARKET");
    expect(html).not.toContain("<CNBC>");
  });
});
