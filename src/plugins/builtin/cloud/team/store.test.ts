import { describe, expect, test } from "bun:test";
import type { TeamNotification, TeamReceivedInvitation, TeamSummary, TeamUpdatedEvent } from "../../../../api-client";
import { MemoryPluginPersistence } from "../../../../test-support/plugin-persistence";
import { configureNotificationLog, flushNotificationLog, getNotificationLog, resetNotificationLogForTest } from "../../../../notifications/notification-log";
import { TeamStore, type TeamStoreClient } from "./store";

function team(overrides: Partial<TeamSummary>): TeamSummary {
  return {
    id: "org-1",
    name: "Macro Desk",
    slug: "macro-desk",
    accentColor: "magenta",
    shortName: "MD",
    allowMemberInvites: false,
    channelId: "team:org-1",
    createdAt: "2026-09-14T12:00:00.000Z",
    role: "member",
    memberCount: 2,
    ...overrides,
  };
}

const teamCard = { id: "org-1", name: "Macro Desk", accentColor: "magenta" as const, shortName: "MD" };

function notification(id: string, kind: "team-invite" | "team-joined" | "layout-updated", createdAt = "2026-09-14T12:00:00.000Z"): TeamNotification {
  const actor = { id: "u2", username: "alice", displayName: "Alice" };
  const data: TeamNotification["data"] =
    kind === "team-invite"
      ? { kind, team: teamCard, invitationId: "inv-1", expiresAt: "2026-09-21T12:00:00.000Z", inviter: actor }
      : kind === "team-joined"
        ? { kind, team: teamCard, member: actor }
        : { kind, team: teamCard, layoutId: "l1", layoutName: "Morning", revision: 2, author: actor };
  return { id, type: kind, channelId: "team:org-1", createdAt, data };
}

function fakeClient(overrides: Partial<TeamStoreClient> = {}) {
  let verified = true;
  let signedIn = true;
  const userListeners = new Set<() => void>();
  const teamListeners = new Set<(n: TeamNotification) => void>();
  const delivered: string[][] = [];
  let teams: TeamSummary[] = [team({ name: "Rates", id: "org-2", shortName: "RT" }), team({})];
  let invitations: TeamReceivedInvitation[] = [];
  const updateListeners = new Set<(event: TeamUpdatedEvent) => void>();
  let listCalls = 0;
  const client: TeamStoreClient = {
    isVerified: () => verified,
    isSignedIn: () => signedIn,
    subscribeCurrentUser: (listener) => {
      userListeners.add(listener);
      return () => userListeners.delete(listener);
    },
    subscribeTeamNotifications: (listener) => {
      teamListeners.add(listener);
      return () => teamListeners.delete(listener);
    },
    subscribeTeamUpdates: (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    listTeams: async () => {
      listCalls += 1;
      return teams;
    },
    listMyTeamInvitations: async () => invitations,
    getTeamNotifications: async () => [],
    markChatNotificationsDelivered: async (ids) => {
      delivered.push(ids);
      return { delivered: ids.length };
    },
    ...overrides,
  };
  return {
    client,
    delivered,
    get listCalls() {
      return listCalls;
    },
    setVerified(value: boolean, options: { signedIn?: boolean } = {}) {
      verified = value;
      signedIn = options.signedIn ?? value;
      for (const listener of userListeners) listener();
    },
    setTeams(next: TeamSummary[]) {
      teams = next;
    },
    setInvitations(next: TeamReceivedInvitation[]) {
      invitations = next;
    },
    push(n: TeamNotification) {
      for (const listener of teamListeners) listener(n);
    },
    pushUpdate(event: TeamUpdatedEvent) {
      for (const listener of updateListeners) listener(event);
    },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TeamStore", () => {
  test("loads teams sorted by name once verified and empties on sign-out", async () => {
    const fake = fakeClient();
    const store = new TeamStore(fake.client);
    const seen: number[] = [];
    store.subscribe((snapshot) => seen.push(snapshot.teams.length));
    store.start();
    await flush();
    expect(store.getSnapshot().teams.map((entry) => entry.name)).toEqual(["Macro Desk", "Rates"]);
    expect(store.getSnapshot().loaded).toBe(true);
    expect(store.getTeam("org-2")?.shortName).toBe("RT");
    expect(store.getTeamForChannel("team:org-1")?.name).toBe("Macro Desk");
    expect(store.findTeam("rt")?.id).toBe("org-2");

    fake.setVerified(false, { signedIn: false });
    expect(store.getSnapshot().teams).toEqual([]);
    expect(store.getSnapshot().loaded).toBe(false);
    expect(seen.at(-1)).toBe(0);
    store.dispose();
  });

  test("keeps loaded teams when auth flickers unverified but session credential remains", async () => {
    const fake = fakeClient();
    const store = new TeamStore(fake.client);
    store.start();
    await flush();
    expect(store.getSnapshot().teams).toHaveLength(2);

    fake.setVerified(false, { signedIn: true });
    expect(store.getSnapshot().teams).toHaveLength(2);

    fake.setVerified(true);
    expect(store.getSnapshot().teams).toHaveLength(2);
    store.dispose();
  });

  test("keeps focus and cards in persistence and derives the default team", () => {
    const persistence = new MemoryPluginPersistence();
    persistence.setState("team-focus", { teamId: "org-1" });
    persistence.setState("team-notifications", [notification("n1", "team-joined")]);
    const store = new TeamStore(fakeClient().client);
    store.attach(persistence);
    expect(store.getSnapshot().focus).toEqual({ teamId: "org-1" });
    expect(store.getSnapshot().notifications.map((entry) => entry.id)).toEqual(["n1"]);
    // Not loaded yet, so the focused team does not resolve to a default.
    expect(store.getDefaultTeamId()).toBeNull();

    store.setFocus("personal");
    expect(persistence.getState("team-focus")).toBe("personal");
  });

  test("receives cards, notifies with an action, refreshes on joins, and dismisses", async () => {
    resetNotificationLogForTest();
    const fake = fakeClient();
    const store = new TeamStore(fake.client);
    const persistence = new MemoryPluginPersistence();
    store.attach(persistence);
    const toasts: Array<{ title?: string; body: string; action?: { label: string } }> = [];
    const opened: string[] = [];
    store.setNotifier((request) => {
      toasts.push({ title: request.title, body: request.body, action: request.action });
      return { toastVisible: true, desktopRequested: false };
    }, { openTeamChannel: (teamId) => opened.push(teamId) });
    store.start();
    await flush();
    const before = fake.listCalls;

    fake.push(notification("n1", "team-joined"));
    await flush();
    expect(toasts).toEqual([
      { title: "MD · Macro Desk", body: "@alice joined Macro Desk.", action: { label: "Open chat", onClick: expect.any(Function) } },
    ]);
    expect(getNotificationLog().filter((entry) => entry.refId === "team:n1")).toEqual([
      expect.objectContaining({ source: "team", title: "MD · Macro Desk", body: "@alice joined Macro Desk.", read: false }),
    ]);
    expect(fake.listCalls).toBe(before + 1);
    toasts[0]?.action && (toasts[0].action as { onClick: () => void }).onClick();
    expect(opened).toEqual(["org-1"]);
    expect(persistence.getState<TeamNotification[]>("team-notifications")?.map((entry) => entry.id)).toEqual(["n1"]);

    fake.push(notification("n2", "layout-updated", "2026-09-14T12:01:00.000Z"));
    fake.push(notification("n2", "layout-updated", "2026-09-14T12:01:00.000Z"));
    await flush();
    expect(store.getSnapshot().notifications.map((entry) => entry.id)).toEqual(["n1", "n2"]);
    // No layout action registered, so no button on that toast.
    expect(toasts[1]?.action).toBeUndefined();

    await store.dismissNotificationsForTeam("org-1", ["layout-updated"]);
    expect(store.getSnapshot().notifications.map((entry) => entry.id)).toEqual(["n1"]);
    expect(getNotificationLog().find((entry) => entry.refId === "team:n2")?.read).toBe(true);
    expect(getNotificationLog().find((entry) => entry.refId === "team:n1")?.read).toBe(false);
    expect(fake.delivered).toEqual([["n2"]]);
    await store.dismissNotifications([]);
    expect(fake.delivered).toHaveLength(1);
    store.dispose();
  });

  test("a card that is only in the pending list is kept in the log once it is marked read", async () => {
    resetNotificationLogForTest();
    const saved: unknown[][] = [];
    configureNotificationLog({ get: () => [], set: (entries) => { saved.push(entries.map((entry) => ({ ...entry }))); } });
    const persistence = new MemoryPluginPersistence();
    persistence.setState("team-notifications", [notification("n1", "team-joined")]);
    const store = new TeamStore(fakeClient().client);
    store.attach(persistence);

    await store.dismissNotifications(["n1"]);
    await flushNotificationLog();

    expect(persistence.getState<TeamNotification[]>("team-notifications")).toEqual([]);
    expect(getNotificationLog()).toEqual([
      expect.objectContaining({
        source: "team",
        read: true,
        refId: "team:n1",
        body: "@alice joined Macro Desk.",
      }),
    ]);
    expect(saved.at(-1)).toEqual([
      expect.objectContaining({ read: true, refId: "team:n1" }),
    ]);
    store.dispose();
  });

  test("team.updated refreshes, tells listeners, and folded channel sections persist", async () => {
    const fake = fakeClient();
    const store = new TeamStore(fake.client);
    const persistence = new MemoryPluginPersistence();
    store.attach(persistence);
    store.start();
    await flush();
    const before = fake.listCalls;
    const seen: TeamUpdatedEvent[] = [];
    const stop = store.onTeamUpdated((event) => seen.push(event));
    fake.pushUpdate({ teamId: "org-1", change: "channels" });
    await flush();
    expect(fake.listCalls).toBe(before + 1);
    expect(seen).toEqual([{ teamId: "org-1", change: "channels" }]);
    stop();

    store.toggleTeamCollapsed("org-1");
    expect(store.isTeamCollapsed("org-1")).toBe(true);
    expect(persistence.getState("team-collapsed-channels")).toEqual(["org-1"]);
    store.toggleTeamCollapsed("org-1");
    expect(store.isTeamCollapsed("org-1")).toBe(false);

    // Applying a server response is immediate; a later refresh confirms it.
    store.upsertTeam(team({ id: "org-3", name: "Alpha", shortName: "AL" }));
    expect(store.getSnapshot().teams.map((entry) => entry.name)).toEqual(["Alpha", "Macro Desk", "Rates"]);
    store.setFocus({ teamId: "org-3" });
    store.removeTeam("org-3");
    expect(store.getSnapshot().teams).toHaveLength(2);
    expect(store.getSnapshot().focus).toBe("all");
    store.dispose();
  });

  test("refresh is shared while in flight and reports errors without dropping teams", async () => {
    let resolveList: ((teams: TeamSummary[]) => void) | null = null;
    let calls = 0;
    const fake = fakeClient({
      listTeams: () => new Promise((resolve) => {
        calls += 1;
        resolveList = resolve;
      }),
    });
    const store = new TeamStore(fake.client);
    const first = store.refresh();
    const second = store.refresh();
    expect(calls).toBe(1);
    expect(store.getSnapshot().loading).toBe(true);
    resolveList?.([team({})]);
    await Promise.all([first, second]);
    expect(store.getSnapshot().teams).toHaveLength(1);
    expect(calls).toBe(1);

    const failing = new TeamStore(fakeClient({ listTeams: async () => { throw new Error("offline"); } }).client);
    await failing.refresh();
    expect(failing.getSnapshot()).toMatchObject({ loaded: true, loading: false, error: "offline" });
  });
});
