import { expect, test } from "bun:test";
import { newsIndexKey, parseNewsIndexRecord, serializeNewsIndexRecord } from "./news-index";

const shareId = "0123456789abcdef0123456789abcdef";

test("indexes a Cloud share id under the article id", () => {
  expect(newsIndexKey("reuters-urn:nFWN4530A2")).toBe("news:reuters-urn:nFWN4530A2");
  expect(parseNewsIndexRecord(serializeNewsIndexRecord(shareId))).toEqual({ shareId });
  expect(parseNewsIndexRecord(shareId)).toEqual({ shareId });
  expect(parseNewsIndexRecord("Xk9mQ2nLp4Ab")).toBeNull();
});
