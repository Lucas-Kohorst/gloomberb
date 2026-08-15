import { describe, expect, test } from "bun:test";
import {
  bundledChangelogReleases,
  HOSTED_CHANGELOG_RELEASE,
  mergeChangelogReleases,
} from "./entries";

describe("bundled changelog", () => {
  test("ships a hosted note with a body the pane can render", () => {
    const [release] = bundledChangelogReleases();
    expect(release?.id).toBe(HOSTED_CHANGELOG_RELEASE.id);
    expect(release?.body.includes("YouTube")).toBe(true);
    expect(release?.body.includes("Kalshi")).toBe(true);
    expect(release?.body.includes("API Keys")).toBe(true);
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
      HOSTED_CHANGELOG_RELEASE.id,
      "75",
    ]);
  });
});
