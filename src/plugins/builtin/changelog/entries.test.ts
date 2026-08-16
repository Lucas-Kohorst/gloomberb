import { describe, expect, test } from "bun:test";
import {
  bundledChangelogReleases,
  HOSTED_CHANGELOG_RELEASE,
  HOSTED_CHANGELOG_RELEASE_PRIOR,
  mergeChangelogReleases,
} from "./entries";

describe("bundled changelog", () => {
  test("ships a hosted note with a body the pane can render", () => {
    const [release] = bundledChangelogReleases();
    expect(release?.id).toBe(HOSTED_CHANGELOG_RELEASE.id);
    expect(release?.body.includes("SEC filings")).toBe(true);
    expect(release?.body.includes("Connections")).toBe(true);
    expect(release?.body.includes("article")).toBe(true);
  });

  test("keeps the prior hosted note bundled behind the newest one", () => {
    const [, prior] = bundledChangelogReleases();
    expect(prior?.id).toBe(HOSTED_CHANGELOG_RELEASE_PRIOR.id);
    expect(prior?.body.includes("YouTube")).toBe(true);
    expect(prior?.body.includes("Kalshi")).toBe(true);
    expect(prior?.body.includes("API Keys")).toBe(true);
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
      HOSTED_CHANGELOG_RELEASE_PRIOR.id,
      "75",
    ]);
  });
});
