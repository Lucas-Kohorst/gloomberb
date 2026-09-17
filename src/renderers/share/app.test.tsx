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
  }, async () => { throw new Error("offline"); }));
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
  const hosted = renderToStaticMarkup(<SocialShareApp location={new URL("https://terminal.kohor.st/s/Xk9mQ2nLp4Ab")} />);
  expect(hosted).toContain("Loading shared view");
  const legacy = renderToStaticMarkup(<SocialShareApp location={new URL("https://terminal.kohor.st/s/abc")} />);
  expect(legacy).toContain("Ask the sender for a new link");
  const invalid = renderToStaticMarkup(<SocialShareApp location={new URL("https://terminal.kohor.st/article?a=invalid")} />);
  expect(invalid).toContain("could not be read");
});

test("canonical news paths boot the slim reader instead of the terminal", async () => {
  const url = new URL("https://terminal.kohor.st/news/reuters-urn:newsml:reuters.com:20260911:nFWN4530A2");
  let documentPath = "";
  await handleRequest(new Request(url), { ASSETS: { fetch: async (request) => {
    documentPath = new URL(request.url).pathname;
    return new Response("share document");
  } } });
  expect(documentPath).toBe("/share.html");
  expect(renderToStaticMarkup(<SocialShareApp location={url} />)).toContain("Loading shared view");
});

test("human-readable article slug paths boot the slim reader instead of the terminal", async () => {
  const url = new URL("https://terminal.kohor.st/article/brief-situational-awareness--AbCd1234");
  let documentPath = "";
  await handleRequest(new Request(url), { ASSETS: { fetch: async (request) => {
    documentPath = new URL(request.url).pathname;
    return new Response("share document");
  } } });
  expect(documentPath).toBe("/share.html");
  expect(renderToStaticMarkup(<SocialShareApp location={url} />)).toContain("Loading shared view");
  const inline = renderToStaticMarkup(<SocialShareApp location={new URL("https://terminal.kohor.st/article?a=invalid")} />);
  expect(inline).toContain("could not be read");
});
