import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createNotesSyncContributor } from "../../../plugins/builtin/notes/sync";
import { setHostedConfigUserId } from "../../../data/config/hosted-user-persist";

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

test("hosted notes support the sync contributor's apply and collect contract", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousHosted = Object.getOwnPropertyDescriptor(globalThis, "__GLOOM_CLOUD_HOSTED");
  const storage = new Window({ url: "https://terminal.kohor.st" }).localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", { configurable: true, value: true });
  setHostedConfigUserId("sync-test");
  try {
    const files = new NotesFiles("cloud://users/sync-test");
    const contributor = createNotesSyncContributor(files);
    const { createDefaultConfig } = await import("../../../types/config");
    const { createInitialState } = await import("../../../core/state/app/state");
    const state = createInitialState(createDefaultConfig("cloud://users/sync-test"));
    const context = {
      state, baselineState: state, baselinePayload: null,
      snapshot: { appId: "gloomberb" as const, schemaVersion: 1 as const, clientId: "test", createdAt: "2026-09-07T00:00:00Z", contributors: {} },
      getState: () => state, isCurrent: () => true, dispatch: () => {},
      tickerRepository: {
        loadAllTickers: async () => [], loadTicker: async () => null,
        saveTicker: async () => {}, deleteTicker: async () => {},
        createTicker: async (metadata: import("../../../types/ticker").TickerMetadata) => ({ metadata }),
      },
    };
    await contributor.apply!({ notes: [{ key: "AAPL", text: "Desktop note", updatedAt: 100 }], quickNotes: [] }, context);
    expect(await files.load("AAPL")).toBe("Desktop note");
    expect(await contributor.collect(context)).toMatchObject({
      notes: [{ key: "AAPL", text: "Desktop note" }], quickNotes: [],
    });
    await files.save("AAPL", "Local edit");
    await contributor.apply!({ notes: [{ key: "AAPL", text: "Older cloud note", updatedAt: 100 }], quickNotes: [] }, context);
    expect(await files.load("AAPL")).toBe("Local edit");
  } finally {
    setHostedConfigUserId(null);
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (previousHosted) Object.defineProperty(globalThis, "__GLOOM_CLOUD_HOSTED", previousHosted);
    else Reflect.deleteProperty(globalThis, "__GLOOM_CLOUD_HOSTED");
  }
});

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
