import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { ContextualCheatsheet } from "./contextual-cheatsheet";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  await act(async () => {
    setup?.renderer.destroy();
  });
  setup = undefined;
});

test("renders the contextual empty state and global actions", async () => {
  setup = await testRender(
    <ContextualCheatsheet
      dialogId="cheatsheet"
      dismiss={() => {}}
      paneId="missing-pane"
      actions={[{
        id: "command-bar",
        key: "Ctrl+P",
        label: "Command bar",
        matches: () => false,
        execute: () => {},
      }]}
    />,
    { width: 80, height: 24 },
  );

  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("No actions are registered for this pane.");
  expect(frame).toContain("Ctrl+P  Command bar");
});
