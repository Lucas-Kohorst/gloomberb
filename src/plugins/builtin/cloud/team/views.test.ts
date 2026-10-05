import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { apiClient, type TeamSummary, type TeamView } from "../../../../api-client";
import { teamStore } from "./store";
import { TeamViewsStore } from "./views";

const team: TeamSummary = {
  id: "team", name: "Desk", slug: "desk", accentColor: "magenta", shortName: "D",
  allowMemberInvites: false, channelId: "team:team", createdAt: "2026-09-01",
  role: "member", memberCount: 2,
};
const view: TeamView = {
  id: "view", teamId: team.id, name: "Private", revision: 1, spec: {}, createdBy: "author",
  author: { username: null, displayName: "Author" }, createdAt: "", updatedAt: "", publishedAt: "",
};

afterEach(() => mock.restore());

test.each(["dispose", "logout"] as const)("late team views cannot restore templates after %s", async (action) => {
  const snapshot = { ...teamStore.getSnapshot(), teams: [team] };
  spyOn(teamStore, "getSnapshot").mockImplementation(() => snapshot);
  spyOn(apiClient, "isVerified").mockReturnValue(true);
  let finish!: (views: TeamView[]) => void;
  spyOn(apiClient, "listTeamViews").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const register = mock(() => () => {});
  const store = new TeamViewsStore();
  store.attach({ registerPaneTemplate: register });
  const pending = store.refresh();
  if (action === "dispose") store.dispose();
  else {
    snapshot.teams = [];
    await store.refresh();
  }
  finish([view]);
  await pending;
  expect(store.list()).toEqual([]);
  expect(register).not.toHaveBeenCalled();
  store.dispose();
});
