import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { publishArticleShare } from "../../shares/publish";
import { handleRequest } from "../cloudflare/worker";
import { SocialShareApp } from "./app";

test("published rich articles reach the built reader and retain snapshot content", async () => {
  const url = new URL(await publishArticleShare({
    type: "news", id: "story", title: "Snapshot story", source: "Wire",
    url: "https://example.com/story", summary: "Captured article body",
    imageUrls: ["https://example.com/image.png"], categories: ["twitter"],
  }));
  let documentPath = "";
  await handleRequest(new Request(url), { ASSETS: { fetch: async (request) => {
    documentPath = new URL(request.url).pathname;
    return new Response("share document");
  } } });
  expect(documentPath).toBe("/share.html");
  const html = renderToStaticMarkup(<SocialShareApp location={url} />);
  expect(html).toContain("Snapshot story");
  expect(html).toContain("Captured article body");
  expect(html).toContain('src="https://example.com/image.png"');
});

test("old or malformed links stay in the reader with an actionable error", () => {
  const legacy = renderToStaticMarkup(<SocialShareApp location={new URL("https://terminal.kohor.st/s/Xk9mQ2nLp4Ab")} />);
  expect(legacy).toContain("Ask the sender for a new link");
  const invalid = renderToStaticMarkup(<SocialShareApp location={new URL("https://terminal.kohor.st/article?a=invalid")} />);
  expect(invalid).toContain("could not be read");
});
