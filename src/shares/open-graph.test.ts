import { describe, expect, test } from "bun:test";
import { injectShareDocumentMeta, shareEmbedFromPayload } from "./open-graph";

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

  test("uses a large card when the article has an https image", () => {
    const meta = shareEmbedFromPayload({
      kind: "article",
      data: {
        title: "Fed day",
        text: "The statement.",
        summary: "Rates unchanged.",
        imageUrls: ["https://cdn.example.com/fed.jpg", "http://insecure.example/x.jpg"],
      },
    }, "https://term.gloom.sh/article/fed-day--aaaaaaaa");
    const html = injectShareDocumentMeta(
      "<html><head><title>Old</title></head><body></body></html>",
      meta,
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:image" content="https://cdn.example.com/fed.jpg"');
    expect(html).toContain('property="og:description" content="Rates unchanged."');
    expect(html).toContain('property="og:url" content="https://term.gloom.sh/article/fed-day--aaaaaaaa"');
    expect(html).not.toContain("insecure.example");
  });

  test("describes a chart by its series and a list as a handoff", () => {
    expect(shareEmbedFromPayload({
      kind: "chart",
      data: {
        title: "NVDA vs QQQ",
        series: [
          { name: "NVDA", points: [{ x: 1, y: 2 }] },
          { name: "QQQ", points: [{ x: 1, y: 3 }] },
        ],
      },
    }).description).toBe("NVDA, QQQ. Chart on Gloom.");
    expect(shareEmbedFromPayload({
      kind: "table",
      data: { title: "Prediction Markets", columns: [], rows: [] },
    }).description).toBe("This list opens in Gloom.");
  });
});

test("inserts dollar replacement tokens literally without duplicating document markup", () => {
  const title = "$& $` $' $$ <script>";
  const html = injectShareDocumentMeta('<html><head><title>Old</title></head><body><script src="app.js"></script></body></html>', { title, description: title });
  expect(html).toContain("<title>$&amp; $` $' $$ &lt;script&gt;</title>");
  expect(html).toContain("content=\"$&amp; $` $' $$ &lt;script&gt;\"");
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html.match(/<head>/g)).toHaveLength(1);
});
