import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../../../../renderers/opentui/test-utils";
import type { ChatUserSummary } from "../../../../api-client";
import { ChannelMemberList } from "./members";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = undefined;
});

test("clicking a member username opens that public profile", async () => {
  const bob: ChatUserSummary = {
    id: "u2",
    username: "bob",
    displayName: "Bob",
    bio: "Trades energy",
    company: "Gloom",
    profilePublic: true,
  };
  const opened: string[] = [];

  await act(async () => {
    testSetup = await testRender(
      <ChannelMemberList
        members={[bob]}
        presence={{}}
        width={40}
        onOpenProfile={(user) => {
          opened.push(user.username ?? "");
        }}
      />,
      { width: 40, height: 3 },
    );
  });
  await act(async () => {
    await testSetup?.renderOnce();
  });

  const lines = testSetup!.captureCharFrame().split("\n");
  const row = lines.findIndex((line) => line.includes("@bob"));
  const col = lines[row]?.indexOf("@bob") ?? -1;
  expect(row).toBeGreaterThanOrEqual(0);
  expect(col).toBeGreaterThanOrEqual(0);

  await act(async () => {
    await testSetup!.mockMouse.click(col + 1, row);
    await testSetup!.renderOnce();
  });

  expect(opened).toEqual(["bob"]);
});
