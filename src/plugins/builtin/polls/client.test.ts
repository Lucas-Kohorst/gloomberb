import { afterEach, describe, expect, test } from "bun:test";
import { voteHubPollsUrl } from "./client";

describe("VoteHub poll URLs", () => {
  afterEach(() => {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  });

  test("desktop hits VoteHub directly", () => {
    expect(voteHubPollsUrl({ pollType: "approval", subject: "Donald Trump" }))
      .toBe("https://api.votehub.com/polls?poll_type=approval&subject=Donald+Trump");
    expect(voteHubPollsUrl({ pollType: "all" })).toBe("https://api.votehub.com/polls");
  });

  test("hosted uses the VoteHub keyed-data proxy", () => {
    (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
    expect(voteHubPollsUrl({ pollType: "approval", subject: "Donald Trump" }))
      .toBe("/api/data/votehub/polls?poll_type=approval&subject=Donald+Trump");
    expect(voteHubPollsUrl()).toBe("/api/data/votehub/polls");
  });
});
