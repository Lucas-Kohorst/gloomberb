import { expect, test } from "bun:test";
import { createShare, getShare } from "./api";
import { decodeArticleSharePayload, type SharePayload } from "./payload";
import { publishArticleShare, publishShare, tableSnapshotSharePayload } from "./publish";
import { buildTableSharePayload } from "./table-snapshot";
import { articleShareSlug, hashArticleId, parseArticleSlugPath, parseShareId } from "./routes";
import { slugifyArticleTitle } from "../utils/slugify";

const id = "0123456789abcdef0123456789abcdef";

test("publishes displayed table values through the stored API and reads the same snapshot", async () => {
  const snapshot = buildTableSharePayload({
    title: "Indices", columns: [{ id: "name", label: "Name" }, { id: "price", label: "Price" }],
    items: [{ name: "RED", price: "51.2%" }],
    cell: (row, column) => column === "name" ? row.name : { text: row.price, color: "green" },
    rowUrl: () => "https://example.com/red",
  });
  let stored: SharePayload | undefined;
  const url = await publishShare(tableSnapshotSharePayload(snapshot), (payload) => createShare(payload,
    async (_, init) => {
      stored = JSON.parse(String(init?.body));
      return Response.json({ id, expiresAt: "2026-10-01T00:00:00Z" });
    }));
  const read = await getShare(parseShareId(new URL(url).pathname)!, async () => Response.json({
    ...stored, createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z",
  }));
  expect(read).toMatchObject({
    kind: "table", data: {
      columns: [{ key: "c0", label: "Name" }, { key: "c1", label: "Price" }, { key: "source", label: "Source" }],
      rows: [{ c0: "RED", c1: "51.2%", source: "https://example.com/red" }],
    },
  });
  expect(() => tableSnapshotSharePayload({ ...snapshot, truncatedFrom: 300 }))
    .toThrow("Filter this table");
  expect(() => tableSnapshotSharePayload({ ...snapshot, rows: Array(201).fill(snapshot.rows[0]) }))
    .toThrow("Filter this table");
});

test("stores a Cloud article snapshot with reader fields", async () => {
  let stored: SharePayload | undefined;
  const articleId = "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2";
  const index = { lookup: async () => null, register: async () => true };
  const url = await publishArticleShare({
    type: "news",
    id: articleId,
    title: "BRIEF-Situational Awareness Active In Options Market - CNBC",
    source: "Reuters News",
    url: "https://www.reuters.com/article",
    summary: "Sept 11 (Reuters) - SITUATIONAL AWARENESS ACTIVE IN OPTIONS MARKET",
    publishedAt: "2026-09-11T13:37:11.000Z",
  }, async (payload) => {
    stored = payload;
    return { id, expiresAt: "2026-10-01T00:00:00Z" };
  }, index);
  expect(new URL(url).pathname).toBe(`/news/${articleId}`);
  expect(stored).toMatchObject({
    kind: "article",
    data: {
      title: "BRIEF-Situational Awareness Active In Options Market - CNBC",
      source: "Reuters News",
      sourceUrl: "https://www.reuters.com/article",
      publishedAt: "2026-09-11T13:37:11.000Z",
      summary: "Sept 11 (Reuters) - SITUATIONAL AWARENESS ACTIVE IN OPTIONS MARKET",
    },
  });
});

test("reuses the canonical news URL when the story was already shared", async () => {
  const articleId = "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2";
  let created = 0;
  const url = await publishArticleShare({
    type: "news",
    id: articleId,
    title: "BRIEF",
    source: "Reuters News",
    url: "https://www.reuters.com/article",
    summary: "body",
  }, async () => {
    created += 1;
    return { id, expiresAt: "2026-10-01T00:00:00Z" };
  }, {
    lookup: async () => id,
    register: async () => true,
  });
  expect(created).toBe(0);
  expect(new URL(url).pathname).toBe(`/news/${articleId}`);
});

test("falls back to a Cloud share URL when the news index cannot be written", async () => {
  const url = await publishArticleShare({
    type: "news",
    id: "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2",
    title: "BRIEF",
    source: "Reuters News",
    url: "https://www.reuters.com/article",
    summary: "body",
  }, async () => ({ id, expiresAt: "2026-10-01T00:00:00Z" }), {
    lookup: async () => null,
    register: async () => false,
  });
  expect(new URL(url).pathname).toBe(`/s/${id}`);
});

test("publishes a human-readable slug URL when the slug index is written", async () => {
  const articleId = "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2";
  const title = "BRIEF-Situational Awareness Active In Options Market - CNBC";
  let registered: { slug: string; articleId: string; shareId: string } | undefined;
  const url = await publishArticleShare({
    type: "news",
    id: articleId,
    title,
    source: "Reuters News",
    url: "https://www.reuters.com/article",
    summary: "body",
  }, async () => ({ id, expiresAt: "2026-10-01T00:00:00Z" }), {
    lookup: async () => null,
    register: async () => true,
  }, async () => null, {
    register: async (slug, registeredArticleId, shareId) => {
      registered = { slug, articleId: registeredArticleId, shareId };
      return true;
    },
  });
  const path = new URL(url).pathname;
  expect(path.startsWith("/article/")).toBe(true);
  expect(path).toContain(slugifyArticleTitle(title));
  expect(registered?.slug).toContain("--");
  expect(parseArticleSlugPath(path)).toBe(registered?.slug);
  expect(registered).toEqual({
    slug: registered!.slug,
    articleId,
    shareId: id,
  });
});

test("falls back to /news when slug registration fails but the news index was written", async () => {
  const articleId = "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2";
  const url = await publishArticleShare({
    type: "news",
    id: articleId,
    title: "BRIEF",
    source: "Reuters News",
    url: "https://www.reuters.com/article",
    summary: "body",
  }, async () => ({ id, expiresAt: "2026-10-01T00:00:00Z" }), {
    lookup: async () => null,
    register: async () => true,
  }, async () => null, {
    register: async () => false,
  });
  expect(new URL(url).pathname).toBe(`/news/${articleId}`);
  expect(new URL(url).pathname.startsWith("/article/")).toBe(false);
});

test("falls back to a hosted short id when Cloud is unavailable", async () => {
  const shortId = "Xk9mQ2nLp4Ab";
  const url = await publishArticleShare({
    type: "news",
    id: "story",
    title: "Story",
    source: "Wire",
    url: "https://example.com/story",
    summary: "body",
  }, async () => { throw new Error("Sign in to Gloom Cloud to share."); }, {
    lookup: async () => null,
    register: async () => false,
  }, async () => ({ id: shortId }));
  expect(new URL(url).pathname).toBe(`/s/${shortId}`);
});

test("uses the hosted slug URL when Cloud is unavailable and the worker indexed one", async () => {
  const shortId = "Xk9mQ2nLp4Ab";
  const articleId = "x:2100984584380842280";
  const title = "Opinion: Macklemore's political messaging";
  const slug = articleShareSlug(slugifyArticleTitle(title), await hashArticleId(articleId));
  const url = await publishArticleShare({
    type: "news",
    id: articleId,
    title,
    source: "@FT",
    url: "https://x.com/FT/status/2100984584380842280",
    summary: title,
  }, async () => { throw new Error("Sign in to Gloom Cloud to share."); }, {
    lookup: async () => null,
    register: async () => false,
  }, async () => ({ id: shortId, slug }));
  expect(new URL(url).pathname).toBe(`/article/${slug}`);
});

test("falls back inline when stored publishing fails", async () => {
  const article = {
    type: "news" as const, id: "story", title: "Story", source: "Wire",
    url: "https://example.com/story", summary: "Complete snapshot",
    imageUrls: ["https://example.com/image.png"],
  };
  let attempts = 0;
  const unavailable = async () => { attempts += 1; throw new Error("Offline"); };
  const rich = new URL(await publishArticleShare(article, unavailable));
  expect(attempts).toBeGreaterThan(0);
  expect(rich.pathname).toBe("/article");
  expect(decodeArticleSharePayload(rich.searchParams.get("a")!)).toEqual(article);
  const plain = { ...article, imageUrls: undefined };
  const fallback = new URL(await publishArticleShare(plain, unavailable));
  expect(decodeArticleSharePayload(fallback.searchParams.get("a")!)?.summary).toBe(plain.summary);
});
