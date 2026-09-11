import { describe, expect, test } from "bun:test";
import {
  buildVolumesUrl,
  parsePublishedDate,
  parseVolume,
  parseVolumesPayload,
} from "./client";

// Shape captured from the live volumes endpoint (fields trimmed to what we read).
const LIVE_TESLA_ITEM = {
  kind: "books#volume",
  id: "OOW5EAAAQBAJ",
  volumeInfo: {
    title: "Tesla: Inventor of the Electrical Age",
    authors: ["W. Bernard Carlson"],
    publisher: "Princeton University Press",
    publishedDate: "2013-05-26",
    pageCount: 520,
    categories: ["Biography & Autobiography"],
    description: "The definitive account of Tesla's life and work.",
    infoLink: "https://books.google.com/books?id=OOW5EAAAQBAJ",
  },
};

const LIVE_YEAR_ONLY_ITEM = {
  id: "year-only-id",
  volumeInfo: {
    title: "A Very Old Book",
    publishedDate: "1897",
  },
};

describe("buildVolumesUrl", () => {
  test("encodes the query with a bounded page size and no api key", () => {
    const url = buildVolumesUrl("Tesla motors");
    expect(new URL(url).searchParams.get("q")).toBe("Tesla motors");
    expect(url).toContain("maxResults=20");
    expect(url).toContain("printType=books");
    expect(url).not.toContain("key=");
  });

  test("passes inauthor:/intitle: qualifiers through untouched", () => {
    const url = buildVolumesUrl("inauthor:Curie intitle:radioactivity");
    expect(new URL(url).searchParams.get("q")).toBe("inauthor:Curie intitle:radioactivity");
  });

  test("clamps maxResults to the API ceiling", () => {
    expect(buildVolumesUrl("Tesla", 999)).toContain("maxResults=40");
    expect(buildVolumesUrl("Tesla", 5)).toContain("maxResults=5");
  });
});

describe("parsePublishedDate", () => {
  test("parses full, month, and year-only dates", () => {
    expect(parsePublishedDate("2013-05-26")?.toISOString()).toBe("2013-05-26T00:00:00.000Z");
    expect(parsePublishedDate("2013-05")?.toISOString()).toBe("2013-05-01T00:00:00.000Z");
    expect(parsePublishedDate("1897")?.toISOString()).toBe("1897-01-01T00:00:00.000Z");
  });

  test("rejects calendar-impossible and non-date values", () => {
    expect(parsePublishedDate("2013-13-01")).toBeNull();
    expect(parsePublishedDate("2013-02-30")).toBeNull();
    expect(parsePublishedDate("May 2013")).toBeNull();
    expect(parsePublishedDate("")).toBeNull();
    expect(parsePublishedDate(null)).toBeNull();
    expect(parsePublishedDate(2013)).toBeNull();
  });
});

describe("parseVolume", () => {
  test("parses a live volume item into book fields", () => {
    const volume = parseVolume(LIVE_TESLA_ITEM);
    expect(volume).toMatchObject({
      id: "OOW5EAAAQBAJ",
      title: "Tesla: Inventor of the Electrical Age",
      authors: ["W. Bernard Carlson"],
      publishedDate: "2013-05-26",
      publisher: "Princeton University Press",
      pageCount: 520,
      categories: ["Biography & Autobiography"],
      description: "The definitive account of Tesla's life and work.",
      infoLink: "https://books.google.com/books?id=OOW5EAAAQBAJ",
    });
    expect(volume?.publishedTime?.toISOString()).toBe("2013-05-26T00:00:00.000Z");
  });

  test("tolerates missing optional fields and year-only dates", () => {
    const volume = parseVolume(LIVE_YEAR_ONLY_ITEM);
    expect(volume).toMatchObject({
      id: "year-only-id",
      authors: [],
      publisher: "",
      pageCount: null,
      categories: [],
      description: "",
      infoLink: "",
    });
    expect(volume?.publishedTime?.toISOString()).toBe("1897-01-01T00:00:00.000Z");
  });

  test("drops items without an id or title and tolerates junk", () => {
    expect(parseVolume({ volumeInfo: { title: "No id" } })).toBeNull();
    expect(parseVolume({ id: "x", volumeInfo: {} })).toBeNull();
    expect(parseVolume({ id: "x" })).toBeNull();
    expect(parseVolume(null)).toBeNull();
    expect(parseVolume("Tesla")).toBeNull();
  });
});

describe("parseVolumesPayload", () => {
  test("keeps usable items and reports the API total", () => {
    const page = parseVolumesPayload({
      kind: "books#volumes",
      totalItems: 342,
      items: [LIVE_TESLA_ITEM, LIVE_YEAR_ONLY_ITEM, { id: "junk" }],
    });
    expect(page.total).toBe(342);
    expect(page.volumes.map((volume) => volume.id)).toEqual(["OOW5EAAAQBAJ", "year-only-id"]);
  });

  test("stops at the display cap instead of mapping every item", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `id-${index}`,
      volumeInfo: { title: `Title ${index}` },
    }));
    const page = parseVolumesPayload({ totalItems: 10, items }, 3);
    expect(page.volumes).toHaveLength(3);
    expect(page.total).toBe(10);
  });

  test("returns an empty page for a body that is not an items array", () => {
    expect(parseVolumesPayload({ totalItems: 0 })).toEqual({ volumes: [], total: 0 });
    expect(parseVolumesPayload({ error: { code: 400 } })).toEqual({ volumes: [], total: 0 });
    expect(parseVolumesPayload(null)).toEqual({ volumes: [], total: 0 });
    expect(parseVolumesPayload("<html>")).toEqual({ volumes: [], total: 0 });
  });
});
