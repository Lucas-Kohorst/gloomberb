import { expect, test } from "bun:test";
import { createRowCountAnnouncer } from "./live-status";

function setup() {
  let clock = 0;
  const messages: string[] = [];
  const announcer = createRowCountAnnouncer((message) => messages.push(message), {
    minIntervalMs: 20,
    now: () => clock,
  });
  return {
    announcer,
    messages,
    advance: async (ms: number) => {
      clock += ms;
      await Bun.sleep(ms + 5);
    },
  };
}

test("the mount count stays silent and the first change is announced immediately", () => {
  const probe = setup();
  probe.announcer.update(40);
  probe.announcer.update(40);
  expect(probe.messages).toEqual([]);
  probe.announcer.update(12);
  expect(probe.messages).toEqual(["12 rows"]);
  probe.announcer.dispose();
});

test("bursts inside the interval collapse into one trailing message with the latest count", async () => {
  const probe = setup();
  probe.announcer.update(10);
  probe.announcer.update(11);
  probe.announcer.update(12);
  probe.announcer.update(1);
  probe.announcer.update(0);
  expect(probe.messages).toEqual(["11 rows"]);
  await probe.advance(20);
  expect(probe.messages).toEqual(["11 rows", "No rows"]);
  probe.announcer.dispose();
});

test("a burst that returns to the announced count says nothing, and dispose cancels pending messages", async () => {
  const probe = setup();
  probe.announcer.update(5);
  probe.announcer.update(6);
  probe.announcer.update(7);
  probe.announcer.update(6);
  await probe.advance(20);
  expect(probe.messages).toEqual(["6 rows"]);

  probe.announcer.update(9);
  expect(probe.messages).toEqual(["6 rows", "9 rows"]);
  probe.announcer.update(1);
  probe.announcer.dispose();
  await probe.advance(20);
  expect(probe.messages).toEqual(["6 rows", "9 rows"]);
});
