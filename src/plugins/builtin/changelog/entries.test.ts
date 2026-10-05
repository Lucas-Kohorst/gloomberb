import { describe, expect, test } from "bun:test";
import {
  bundledChangelogReleases,
  HOSTED_CHANGELOG_RELEASE,
  HOSTED_CHANGELOG_RELEASES,
  mergeChangelogReleases,
} from "./entries";

describe("bundled changelog", () => {
  test("leads with the newest note and ships a body the pane can render", () => {
    const releases = bundledChangelogReleases();
    expect(releases[0]?.id).toBe(HOSTED_CHANGELOG_RELEASE.id);
    expect(releases).toHaveLength(HOSTED_CHANGELOG_RELEASES.length);
    for (const release of releases) {
      expect(release.body.trim().length).toBeGreaterThan(0);
      expect(release.tagName.trim().length).toBeGreaterThan(0);
    }
  });

  test("orders bundled notes newest first", () => {
    const published = bundledChangelogReleases().map((release) => Date.parse(release.publishedAt));
    expect(published).toEqual([...published].sort((left, right) => right - left));
  });

  // mergeChangelogReleases dedupes by tagName, so a repeated tag would silently
  // swallow a bundled note.
  test("gives every bundled note a distinct tag", () => {
    const tags = bundledChangelogReleases().map((release) => release.tagName);
    expect(new Set(tags).size).toBe(tags.length);
  });

  test("keeps bundled notes ahead of GitHub releases with the same tag", () => {
    const merged = mergeChangelogReleases(
      bundledChangelogReleases(),
      [{
        ...HOSTED_CHANGELOG_RELEASE,
        id: "remote-dup",
        title: "Remote duplicate",
        body: "should be dropped",
      }, {
        id: "75",
        tagName: "v0.10.4",
        version: "v0.10.4",
        title: "Older release",
        body: "older",
        publishedAt: "2026-08-07T10:26:08Z",
        url: "https://example.com",
      }],
    );
    expect(merged.map((release) => release.id)).toEqual([
      ...HOSTED_CHANGELOG_RELEASES.map((release) => release.id),
      "75",
    ]);
  });

  test("keeps newer GitHub releases and sorts them ahead of this build", () => {
    const merged = mergeChangelogReleases(
      bundledChangelogReleases(),
      [{
        id: "upstream-newer",
        tagName: "v0.15.6",
        version: "v0.15.6",
        title: "Panes that follow a watchlist",
        body: "upstream note",
        publishedAt: "2026-10-02T00:00:00Z",
        url: "https://example.com",
      }, {
        id: "upstream-0-11-3",
        tagName: "v0.11.3",
        version: "v0.11.3",
        title: "World venues, options analytics, and CSV exports",
        body: "older line, later publish date",
        publishedAt: "2026-08-29T21:07:42Z",
        url: "https://example.com/v0.11.3",
      }, {
        id: "75",
        tagName: "v0.10.4",
        version: "v0.10.4",
        title: "Older release",
        body: "older",
        publishedAt: "2026-08-07T10:26:08Z",
        url: "https://example.com",
      }],
    );
    expect(merged[0]?.tagName).toBe("v0.15.6");
    expect(merged[1]?.tagName).toBe("v0.13.15");
    expect(merged.at(-1)?.id).toBe("75");
    const tags = merged.map((release) => release.tagName);
    expect(tags.indexOf("v0.13.12")).toBeLessThan(tags.indexOf("v0.11.3"));
    expect(tags.indexOf("v0.11.3")).toBeLessThan(tags.indexOf("v0.11.0"));
    expect(merged.find((release) => release.tagName === "v0.11.3")?.body).toBe("older line, later publish date");
    const rank = (tagName: string): number[] => tagName.replace(/^v/i, "").split(".").map((part) => Number(/^\d+/.exec(part)?.[0] ?? 0));
    for (let index = 1; index < tags.length; index += 1) {
      const previous = rank(tags[index - 1] ?? "");
      const current = rank(tags[index] ?? "");
      const length = Math.max(previous.length, current.length);
      let order = 0;
      for (let part = 0; part < length; part += 1) {
        order = (previous[part] ?? 0) - (current[part] ?? 0);
        if (order !== 0) break;
      }
      expect(order).toBeGreaterThanOrEqual(0);
    }
  });
});
