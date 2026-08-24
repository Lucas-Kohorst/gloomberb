import { expect, mock, test } from "bun:test";

mock.module("./backend-rpc", () => ({
  backendRequest: async () => ({
    quickNotesIndex: [],
    quickNotes: { "1": "hello" },
    tickerNotes: {},
  }),
}));

const { NotesFiles } = await import("./notes-files");

test("view NotesFiles collectAllForSync exists and returns a snapshot", async () => {
  const notes = new NotesFiles("/tmp/notes");
  expect(typeof notes.collectAllForSync).toBe("function");
  await expect(notes.collectAllForSync()).resolves.toEqual({
    quickNotesIndex: [],
    quickNotes: { "1": "hello" },
    tickerNotes: {},
  });
});
