import { expect, test } from "bun:test";
import {
  parseArticleSlugRecord,
  serializeArticleSlugRecord,
  slugIndexKey,
} from "./news-index";
import { articleShareSlug, hashArticleId, parseArticleSlugPath } from "./routes";
import { slugifyArticleTitle } from "../utils/slugify";

const shareId = "0123456789abcdef0123456789abcdef";
const articleId = "reuters-urn:newsml:reuters.com:20260911:nFWN4530A2";

test("indexes slug records under the full public slug", async () => {
  const titleSlug = slugifyArticleTitle("BRIEF-Situational Awareness");
  const idHash = await hashArticleId(articleId);
  const fullSlug = articleShareSlug(titleSlug, idHash);
  expect(slugIndexKey(fullSlug)).toBe(`slug:${fullSlug}`);
  expect(parseArticleSlugPath(`/article/${fullSlug}`)).toBe(fullSlug);
  expect(parseArticleSlugRecord(serializeArticleSlugRecord(articleId, shareId))).toEqual({
    articleId,
    shareId,
  });
  expect(parseArticleSlugRecord(serializeArticleSlugRecord(articleId))).toEqual({ articleId });
  expect(parseArticleSlugRecord({ articleId: "Xk9mQ2nLp4Ab", shareId: "short" })).toBeNull();
});
