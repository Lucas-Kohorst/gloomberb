export const PANE_BODY_PAD_CELLS = 1;
export const PANE_SECTION_GAP_CELLS = 1;
export const PANE_TABLE_PAD_CELLS = 1;
export const PANE_BODY_PAD_PX = 12;
export const PANE_SECTION_GAP_PX = 12;
export const PANE_TABLE_PAD_PX = 12;

export function paneBodyPadStyle(kind: "opentui" | "desktop-web"): {
  padding: number | string;
  gap: number | string;
} {
  if (kind === "desktop-web") {
    return { padding: `${PANE_BODY_PAD_PX}px`, gap: `${PANE_SECTION_GAP_PX}px` };
  }
  return { padding: PANE_BODY_PAD_CELLS, gap: PANE_SECTION_GAP_CELLS };
}
