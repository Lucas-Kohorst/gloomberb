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
});
