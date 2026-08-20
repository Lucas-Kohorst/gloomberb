import { describe, expect, test } from "bun:test";
import { SHARE_HOSTED_ORIGIN } from "../../shares/routes";
import { usListingsUniverseUrl } from "./client";

describe("us listings client", () => {
  test("hosted clients hydrate same-origin Adjacent Cloud, not Yahoo", () => {
    (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
    expect(usListingsUniverseUrl()).toBe("/api/data/us-listings/universe");
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("desktop/TUI hydrates from Adjacent Cloud origin, not Nasdaq scrape", () => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
    expect(usListingsUniverseUrl()).toBe(`${SHARE_HOSTED_ORIGIN}/api/data/us-listings/universe`);
  });
});
