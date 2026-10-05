import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { apiClient, type CalendarFeed } from "../../../api-client";
import { ApiRequestError } from "../../../api-client/errors";
import { testRender } from "../../../renderers/opentui/test-utils";
import { CalendarAccountTab } from "./calendar-tab";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
const originalGet = apiClient.getCalendarFeed;

async function renderTab() {
  testSetup = await testRender(<CalendarAccountTab width={60} sessionMarker="session-a" />, { width: 80, height: 24 });
  await testSetup.renderOnce();
}

async function waitForFrame(text: string): Promise<string> {
  const deadline = performance.now() + 2_000;
  let frame = testSetup!.captureCharFrame();
  while (!frame.includes(text) && performance.now() < deadline) {
    await act(async () => {
      await Bun.sleep(5);
      await testSetup!.renderOnce();
    });
    frame = testSetup!.captureCharFrame();
  }
  if (frame.includes(text)) return frame;
  throw new Error(`Timed out waiting for "${text}". Last frame:\n${frame}`);
}

afterEach(async () => {
  apiClient.getCalendarFeed = originalGet;
  if (testSetup) {
    await act(async () => testSetup!.renderer.destroy());
    testSetup = undefined;
  }
});

describe("calendar feed link", () => {
  test("says there is no link until one is created", async () => {
    apiClient.getCalendarFeed = async () => null;
    await renderTab();
    const frame = await waitForFrame("No calendar link yet.");
    expect(frame).toContain("No calendar link yet.");
    expect(frame).not.toContain("https://");
    expect(frame).toContain("Copy Calendar Link");
  });

  test("shows the private link when the account already has one", async () => {
    const feed: CalendarFeed = {
      url: "https://feeds.example/calendar/private.ics",
      createdAt: "2026-10-01T00:00:00.000Z",
      lastFetchedAt: null,
    };
    apiClient.getCalendarFeed = async () => feed;
    await renderTab();
    const frame = await waitForFrame(feed.url);
    expect(frame).toContain(feed.url);
    expect(frame).toContain("Active");
    expect(frame).toContain("Not yet");
    expect(frame).not.toContain("No calendar link yet.");
  });

  test("says the link is unavailable when the server has no calendar route", async () => {
    apiClient.getCalendarFeed = async () => {
      throw new ApiRequestError("missing", 404);
    };
    await renderTab();
    const frame = await waitForFrame("Calendar links are not available yet.");
    expect(frame).toContain("Calendar links are not available yet.");
    expect(frame).not.toContain("https://");
  });
});
