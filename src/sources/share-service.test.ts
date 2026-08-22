import { afterEach, describe, expect, test } from "bun:test";
import { createShare } from "./share-service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createShare", () => {
  test("explains unverified Gloom Cloud email on 403", async () => {
    globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
    await expect(createShare({ kind: "article", data: { title: "x" } })).rejects.toThrow(
      "Verify your Gloom Cloud email to share.",
    );
  });
});
