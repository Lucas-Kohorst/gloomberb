import { expect, mock, test } from "bun:test";

// Note: this mock is intentionally not restored. The real backend-rpc reads
// `window` at import time, so it cannot be captured in a DOM-less bun run,
// and no other test file imports it (view entry points that do import it
// install DOM globals first).
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
