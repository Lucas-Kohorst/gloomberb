import { expect, mock, test } from "bun:test";

mock.module("./backend-rpc", () => ({
  backendRequest: async () => {
    throw new Error("hosted collectAllForSync must not invoke RPC");
  },
}));

const { NotesFiles } = await import("./notes-files");

test("hosted stub collectAllForSync is a function and does not throw", async () => {
  (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED = true;
  try {
    const notes = new NotesFiles("/tmp/gloomberb-notes-sync-missing");
    expect(typeof notes.collectAllForSync).toBe("function");
    await expect(notes.collectAllForSync()).resolves.toEqual({
      quickNotesIndex: [],
      quickNotes: {},
      tickerNotes: {},
    });
  } finally {
    delete (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED;
  }
});
