export type TeamPaneSection = "members" | "invites" | "channels" | "settings";

/**
 * What the pane should show when it opens or is brought back: a team and a
 * section, or the create form. Commands and chips set it before creating the
 * pane; an open pane consumes it as it arrives, the way ACM tabs work.
 */
export interface TeamPaneView {
  teamId?: string | null;
  section?: TeamPaneSection;
  mode?: "team" | "create";
}

let pending: TeamPaneView | null = null;
const listeners = new Set<(view: TeamPaneView) => void>();

export function requestTeamPaneView(view: TeamPaneView): void {
  pending = view;
  if (listeners.size === 0) return;
  for (const listener of listeners) listener(view);
  pending = null;
}

export function consumeRequestedTeamPaneView(): TeamPaneView | null {
  const view = pending;
  pending = null;
  return view;
}

export function subscribeRequestedTeamPaneView(listener: (view: TeamPaneView) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const TEAM_PANE_ID = "team";
export const TEAM_PANE_TEMPLATE_ID = "team-pane";

/** Opens (or refocuses) the team pane on the requested view. */
export function openTeamPane(
  createPaneFromTemplate: (templateId: string, options?: { arg?: string }) => void,
  view: TeamPaneView = {},
): void {
  requestTeamPaneView(view);
  createPaneFromTemplate(TEAM_PANE_TEMPLATE_ID);
}
