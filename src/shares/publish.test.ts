import { expect, test } from "bun:test";
import { createShare, getShare } from "./api";
import { decodeArticleSharePayload, type SharePayload } from "./payload";
import { publishArticleShare, publishShare, tableSnapshotSharePayload } from "./publish";
import { buildTableSharePayload } from "./table-snapshot";
import { parseShareId } from "./routes";

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

test("keeps rich article snapshots inline and falls back inline when stored publishing fails", async () => {
  const article = {
    type: "news" as const, id: "story", title: "Story", source: "Wire",
    url: "https://example.com/story", summary: "Complete snapshot",
    imageUrls: ["https://example.com/image.png"],
  };
  let attempts = 0;
  const unavailable = async () => { attempts += 1; throw new Error("Offline"); };
  const rich = new URL(await publishArticleShare(article, unavailable));
  expect(attempts).toBe(0);
  expect(rich.pathname).toBe("/article");
  expect(decodeArticleSharePayload(rich.searchParams.get("a")!)).toEqual(article);
  const plain = { ...article, imageUrls: undefined };
  const fallback = new URL(await publishArticleShare(plain, unavailable));
  expect(attempts).toBe(1);
  expect(decodeArticleSharePayload(fallback.searchParams.get("a")!)?.summary).toBe(plain.summary);
});
