import { expect, test } from "bun:test";
import {
  appReducer,
  createInitialState,
  type AppAction,
  type AppState,
} from "../core/state/app/state";
import type { TickerRepository } from "../data/ticker-repository";
import { createDefaultConfig } from "../types/config";
import {
  __syncContributorInternalsForTests,
  coreConfigSyncContributor,
} from "./core-contributors";
import { CloudSyncController } from "./controller";
import {
  SYNC_SNAPSHOT_SCHEMA_VERSION,
  type SyncContributor,
  type SyncSnapshot,
  type SyncSnapshotResponse,
  type SyncTransport,
} from "./types";

test("does not push local state when the initial pull fails", async () => {
  let pushes = 0;
  const transport: SyncTransport = {
    id: "failing-pull",
    isAvailable: () => true,
    pullSnapshot: () => Promise.reject(new Error("pull failed")),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 1, updatedAt: new Date().toISOString() };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  await controller.requestSync({ force: true });

  expect(pushes).toBe(0);
  expect(controller.getStatus()).toMatchObject({ phase: "error", error: "pull failed" });
});

test("rejects incompatible snapshot versions before applying or pushing", async () => {
  let applied = 0;
  let pushes = 0;
  const contributor: SyncContributor = {
    id: "test.settings",
    schemaVersion: 2,
    collect: () => ({ local: true }),
    apply: () => {
      applied += 1;
    },
  };
  const snapshot = {
    schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION + 1,
    appId: "gloomberb",
    clientId: "future-client",
    createdAt: "2026-07-26T00:00:00.000Z",
    contributors: {},
  } as unknown as SyncSnapshot;
  const transport: SyncTransport = {
    id: "future-snapshot",
    isAvailable: () => true,
    pullSnapshot: async () => ({ snapshot, revision: 1, updatedAt: snapshot.createdAt }),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 2, updatedAt: snapshot.createdAt };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  await controller.requestSync({ force: true });

  expect(applied).toBe(0);
  expect(pushes).toBe(0);
  expect(controller.getStatus()).toMatchObject({
    phase: "error",
    error: `Unsupported sync snapshot schema version ${SYNC_SNAPSHOT_SCHEMA_VERSION + 1}; expected ${SYNC_SNAPSHOT_SCHEMA_VERSION}`,
  });
});

test("rejects incompatible contributor versions before applying or pushing", async () => {
  let applied = 0;
  let pushes = 0;
  const contributor: SyncContributor = {
    id: "test.settings",
    schemaVersion: 2,
    collect: () => ({ local: true }),
    apply: () => {
      applied += 1;
    },
  };
  const snapshot: SyncSnapshot = {
    schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
    appId: "gloomberb",
    clientId: "old-client",
    createdAt: "2026-07-26T00:00:00.000Z",
    contributors: {
      "test.settings": {
        schemaVersion: 1,
        updatedAt: "2026-07-26T00:00:00.000Z",
        payload: { remote: true },
      },
    },
  };
  const transport: SyncTransport = {
    id: "old-contributor",
    isAvailable: () => true,
    pullSnapshot: async () => ({ snapshot, revision: 1, updatedAt: snapshot.createdAt }),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 2, updatedAt: snapshot.createdAt };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  await controller.requestSync({ force: true });

  expect(applied).toBe(0);
  expect(pushes).toBe(0);
  expect(controller.getStatus()).toMatchObject({
    phase: "error",
    error: "Unsupported sync contributor schema for test.settings: 1; expected 2",
  });
});

test("keeps startup layout changes while serializing pull and push", async () => {
  let state = createInitialState(createDefaultConfig("/tmp/gloomberb-sync-controller-test"));
  const dispatch = (action: AppAction) => {
    state = appReducer(state, action);
  };
  let resolvePull!: (response: SyncSnapshotResponse) => void;
  const deferredPull = new Promise<SyncSnapshotResponse>((resolve) => {
    resolvePull = resolve;
  });
  let pulls = 0;
  const pushes: Array<{
    snapshot: SyncSnapshot;
    options?: { baseRevision?: number | null };
  }> = [];
  const transport: SyncTransport = {
    id: "deferred-pull",
    isAvailable: () => true,
    pullSnapshot: () => {
      pulls += 1;
      return deferredPull;
    },
    pushSnapshot: async (snapshot, options) => {
      pushes.push({ snapshot, options });
      return { revision: 8, updatedAt: "2026-07-13T10:00:08.000Z" };
    },
  };
  const contributor: SyncContributor = {
    ...coreConfigSyncContributor,
    apply: (payload, context) => {
      const config = __syncContributorInternalsForTests.mergeConfigPayload(
        context.state.config,
        payload,
        context.baselineState.config,
      );
      if (config) context.dispatch({ type: "SET_CONFIG", config });
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => state,
    dispatch,
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  const startupSync = controller.requestSync({ reason: "startup" });
  const startupPane = {
    instanceId: "help:startup",
    paneId: "help",
    binding: { kind: "none" as const },
  };
  const localLayout = {
    ...state.config.layout,
    instances: [...state.config.layout.instances, startupPane],
    floating: [
      ...state.config.layout.floating,
      { instanceId: startupPane.instanceId, x: 4, y: 3, width: 60, height: 20 },
    ],
  };
  dispatch({
    type: "SET_CONFIG",
    config: {
      ...state.config,
      layout: localLayout,
      layouts: state.config.layouts.map((saved, index) => (
        index === state.config.activeLayoutIndex ? { ...saved, layout: localLayout } : saved
      )),
    },
  });
  const queuedPush = controller.requestSync({ reason: "state-change" });

  const remoteConfig = createDefaultConfig("/remote/path-is-not-synced");
  remoteConfig.theme = "green";
  resolvePull({
    snapshot: {
      schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
      appId: "gloomberb",
      clientId: "remote-client",
      createdAt: "2026-07-13T10:00:07.000Z",
      contributors: {
        "core.config": {
          schemaVersion: 1,
          updatedAt: "2026-07-13T10:00:07.000Z",
          payload: __syncContributorInternalsForTests.collectCoreConfigPayload(remoteConfig),
        },
      },
    },
    revision: 7,
    updatedAt: "2026-07-13T10:00:07.000Z",
  });
  await Promise.all([startupSync, queuedPush]);

  const pushedConfig = pushes[0]?.snapshot.contributors["core.config"]?.payload as {
    layout: AppState["config"]["layout"];
  };
  expect(pulls).toBe(2);
  expect(pushes).toHaveLength(1);
  expect(pushes[0]?.options).toEqual({ baseRevision: 7 });
  expect(state.config.theme).toBe("green");
  expect(state.config.layout.instances).toContainEqual(startupPane);
  expect(pushedConfig.layout.instances).toContainEqual(startupPane);
});

test("keeps the latest layout when switching away and back during a pull", async () => {
  let state = createInitialState(createDefaultConfig("/tmp/gloomberb-sync-layout-roundtrip-test"));
  const dispatch = (action: AppAction) => {
    state = appReducer(state, action);
  };
  dispatch({ type: "SWITCH_LAYOUT", index: 1 });
  dispatch({ type: "SWITCH_LAYOUT", index: 0 });

  let resolvePull!: (response: SyncSnapshotResponse) => void;
  const deferredPull = new Promise<SyncSnapshotResponse>((resolve) => {
    resolvePull = resolve;
  });
  const pushes: SyncSnapshot[] = [];
  const transport: SyncTransport = {
    id: "deferred-layout-pull",
    isAvailable: () => true,
    pullSnapshot: () => deferredPull,
    pushSnapshot: async (snapshot) => {
      pushes.push(snapshot);
      return { revision: 12, updatedAt: "2026-07-21T10:00:12.000Z" };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => state,
    dispatch,
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor: coreConfigSyncContributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  const startupSync = controller.requestSync({ reason: "startup" });
  dispatch({ type: "SWITCH_LAYOUT", index: 1 });
  dispatch({ type: "SWITCH_LAYOUT", index: 0 });
  const queuedPush = controller.requestSync({ reason: "state-change" });

  const remoteConfig = createDefaultConfig("/remote/path-is-not-synced");
  remoteConfig.theme = "green";
  remoteConfig.layout = remoteConfig.layouts[1]!.layout;
  remoteConfig.activeLayoutIndex = 1;
  resolvePull({
    snapshot: {
      schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
      appId: "gloomberb",
      clientId: "remote-client",
      createdAt: "2026-07-21T10:00:11.000Z",
      contributors: {
        "core.config": {
          schemaVersion: 1,
          updatedAt: "2026-07-21T10:00:11.000Z",
          payload: __syncContributorInternalsForTests.collectCoreConfigPayload(remoteConfig),
        },
      },
    },
    revision: 11,
    updatedAt: "2026-07-21T10:00:11.000Z",
  });
  await Promise.all([startupSync, queuedPush]);

  const pushedConfig = pushes[0]?.contributors["core.config"]?.payload as {
    activeLayoutIndex: number;
  };
  expect(state.config.theme).toBe("green");
  expect(state.config.activeLayoutIndex).toBe(0);
  expect(pushedConfig.activeLayoutIndex).toBe(0);
});


test("aborts pull and skips push when runtime is swapped mid-iteration", async () => {
  let resolveApplyB!: () => void;
  const applyBHanging = new Promise<void>((resolve) => {
    resolveApplyB = resolve;
  });
  let applyBStarted!: () => void;
  const applyBStartedPromise = new Promise<void>((resolve) => {
    applyBStarted = resolve;
  });

  let appliedA = false;
  let appliedB = false;
  let dispatchedB = false;
  let pushes = 0;

  const contributorA: SyncContributor = {
    id: "test.a",
    schemaVersion: 1,
    collect: () => ({ a: true }),
    apply: () => {
      appliedA = true;
    },
  };
  const contributorB: SyncContributor = {
    id: "test.b",
    schemaVersion: 1,
    collect: () => ({ b: true }),
    apply: async (_payload, context) => {
      appliedB = true;
      applyBStarted();
      await applyBHanging;
      if (context.isCurrent()) {
        dispatchedB = true;
      }
    },
  };

  const snapshot: SyncSnapshot = {
    schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
    appId: "gloomberb",
    clientId: "remote-client",
    createdAt: "2026-08-16T00:00:00.000Z",
    contributors: {
      "test.a": { schemaVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z", payload: { a: true } },
      "test.b": { schemaVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z", payload: { b: true } },
    },
  };
  const transport: SyncTransport = {
    id: "race-swap",
    isAvailable: () => true,
    pullSnapshot: async () => ({ snapshot, revision: 1, updatedAt: "2026-08-16T00:00:00.000Z" }),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 2, updatedAt: "2026-08-16T00:00:01.000Z" };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [
      { pluginId: "test", contributor: contributorA },
      { pluginId: "test", contributor: contributorB },
    ],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  const syncPromise = controller.requestSync({ force: true });
  await applyBStartedPromise;

  // Swap to a different runtime while contributor B's apply is still pending.
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [],
    getTransport: () => ({
      pluginId: "test",
      transport: {
        id: "new-transport",
        isAvailable: () => true,
        pullSnapshot: async () => ({ snapshot: null, revision: 0, updatedAt: null }),
        pushSnapshot: async () => ({ revision: 1, updatedAt: "2026-08-16T00:00:02.000Z" }),
      },
    }),
  });

  resolveApplyB();
  await syncPromise;

  expect(appliedA).toBe(true);
  expect(appliedB).toBe(true);
  expect(dispatchedB).toBe(false);
  expect(pushes).toBe(0);
});

test("aborts pull and surfaces error when a contributor apply throws mid-iteration", async () => {
  let appliedA = false;
  let appliedB = false;
  let pushes = 0;

  const contributorA: SyncContributor = {
    id: "test.a",
    schemaVersion: 1,
    collect: () => ({ a: true }),
    apply: () => {
      appliedA = true;
    },
  };
  const contributorB: SyncContributor = {
    id: "test.b",
    schemaVersion: 1,
    collect: () => ({ b: true }),
    apply: () => {
      appliedB = true;
      throw new Error("apply B failed");
    },
  };

  const snapshot: SyncSnapshot = {
    schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
    appId: "gloomberb",
    clientId: "remote-client",
    createdAt: "2026-08-16T00:00:00.000Z",
    contributors: {
      "test.a": { schemaVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z", payload: { a: true } },
      "test.b": { schemaVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z", payload: { b: true } },
    },
  };
  const transport: SyncTransport = {
    id: "apply-throws",
    isAvailable: () => true,
    pullSnapshot: async () => ({ snapshot, revision: 1, updatedAt: "2026-08-16T00:00:00.000Z" }),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 2, updatedAt: "2026-08-16T00:00:01.000Z" };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [
      { pluginId: "test", contributor: contributorA },
      { pluginId: "test", contributor: contributorB },
    ],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  await controller.requestSync({ force: true });

  expect(appliedA).toBe(true);
  expect(appliedB).toBe(true);
  expect(pushes).toBe(0);
  expect(controller.getStatus()).toMatchObject({ phase: "error", error: "apply B failed" });
});

test("queues a second requestSync while one is in flight and runs it after", async () => {
  let resolvePull!: (response: SyncSnapshotResponse) => void;
  const deferredPull = new Promise<SyncSnapshotResponse>((resolve) => {
    resolvePull = resolve;
  });
  let pulls = 0;
  let pushes = 0;

  // Mutable collect value so every assembled snapshot has a different signature,
  // guaranteeing the queued sync also pushes.
  let collectCount = 0;
  const contributor: SyncContributor = {
    id: "test.counter",
    schemaVersion: 1,
    collect: () => ({ count: ++collectCount }),
    apply: () => {},
  };

  const transport: SyncTransport = {
    id: "queued-sync",
    isAvailable: () => true,
    pullSnapshot: () => {
      pulls += 1;
      return deferredPull;
    },
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: pushes, updatedAt: "2026-08-16T00:00:00.000Z" };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  const firstPromise = controller.requestSync({ force: true });
  // Second call while the first is in flight: queues a follow-up sync.
  const secondPromise = controller.requestSync({ force: true });

  resolvePull({ snapshot: null, revision: 1, updatedAt: "2026-08-16T00:00:00.000Z" });
  // Both promises resolve only after the queued sync also completes.
  await Promise.all([firstPromise, secondPromise]);

  // Two pulls (one per sync — always pull before push), two pushes (one per sync).
  expect(pulls).toBe(2);
  expect(pushes).toBe(2);
});

test("skips push when snapshot signature is unchanged, but force overrides the skip", async () => {
  let pushes = 0;
  const contributor: SyncContributor = {
    id: "test.stable",
    schemaVersion: 1,
    collect: () => ({ stable: true }),
    apply: () => {},
  };
  const transport: SyncTransport = {
    id: "signature-skip",
    isAvailable: () => true,
    pullSnapshot: async () => ({ snapshot: null, revision: 1, updatedAt: "2026-08-16T00:00:00.000Z" }),
    pushSnapshot: async () => {
      pushes += 1;
      return { revision: 2, updatedAt: "2026-08-16T00:00:01.000Z" };
    },
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  // First sync: pull + push (lastSignature is null so push always fires).
  await controller.requestSync({ force: true });
  expect(pushes).toBe(1);

  // Second sync: signature matches lastSignature, push is skipped.
  await controller.requestSync();
  expect(pushes).toBe(1);

  // Third sync with force: bypasses the signature check and pushes.
  await controller.requestSync({ force: true });
  expect(pushes).toBe(2);
});

test("pulls remote changes on later syncs instead of only once per session", async () => {
  const applied: unknown[] = [];
  const contributor: SyncContributor = {
    id: "test.data",
    schemaVersion: 1,
    collect: () => ({ local: applied.at(-1) ?? null }),
    apply: (payload) => {
      applied.push(payload);
    },
  };
  let remote = { value: 1 };
  let remoteRevision = 4;
  let pulls = 0;
  const transport: SyncTransport = {
    id: "repeat-pull",
    isAvailable: () => true,
    pullSnapshot: async () => {
      pulls += 1;
      return {
        snapshot: {
          schemaVersion: SYNC_SNAPSHOT_SCHEMA_VERSION,
          appId: "gloomberb",
          clientId: "remote-client",
          createdAt: "2026-08-27T00:00:00.000Z",
          contributors: {
            "test.data": {
              schemaVersion: 1,
              updatedAt: "2026-08-27T00:00:00.000Z",
              payload: remote,
            },
          },
        },
        revision: remoteRevision,
        updatedAt: "2026-08-27T00:00:00.000Z",
      };
    },
    pushSnapshot: async () => ({ revision: remoteRevision + 1, updatedAt: "2026-08-27T00:00:01.000Z" }),
  };
  const controller = new CloudSyncController();
  controller.setRuntime({
    getState: () => ({} as AppState),
    dispatch: () => {},
    tickerRepository: {} as TickerRepository,
    getContributors: () => [{ pluginId: "test", contributor }],
    getTransport: () => ({ pluginId: "test", transport }),
  });

  await controller.requestSync({ reason: "startup" });
  remote = { value: 2 };
  remoteRevision = 12;
  await controller.requestSync({ reason: "poll" });

  expect(pulls).toBe(2);
  expect(applied).toEqual([{ value: 1 }, { value: 2 }]);
});
