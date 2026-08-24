
export type PredictionKeyboardCommand =
  | "escape"
  | "search"
  | "move-down"
  | "move-up"
  | "previous-category"
  | "next-category"
  | "previous-venue-tab"
  | "next-venue-tab"
  | "toggle-watchlist"
  | "refresh"
  | "previous-browse-tab"
  | "next-browse-tab"
  | "browse-top"
  | "browse-ending"
  | "browse-new"
  | "filter-all"
  | "filter-watchlist";

export interface PredictionKeyboardEventLike {
  name?: string;
  sequence?: string;
  shift?: boolean;
}

function matchesPredictionKey(
  event: PredictionKeyboardEventLike,
  names: string[],
  sequences: string[] = [],
): boolean {
  const normalizedName = event.name?.toLowerCase();
  if (normalizedName && names.includes(normalizedName)) return true;
  return sequences.includes(event.sequence ?? "");
}

export function resolvePredictionKeyboardCommand(
  event: PredictionKeyboardEventLike,
): PredictionKeyboardCommand | null {
  if (matchesPredictionKey(event, ["escape", "esc"], ["\u001b"]))
    return "escape";
  if (matchesPredictionKey(event, ["/"], ["/"])) return "search";
  if (matchesPredictionKey(event, ["down", "j"], ["j", "\u001b[B", "\u001bOB"]))
    return "move-down";
  if (matchesPredictionKey(event, ["up", "k"], ["k", "\u001b[A", "\u001bOA"]))
    return "move-up";
  if (
    event.shift &&
    matchesPredictionKey(event, ["left", "h"], ["H", "\u001b[1;2D"])
  )
    return "previous-venue-tab";
  if (
    event.shift &&
    matchesPredictionKey(event, ["right", "l"], ["L", "\u001b[1;2C"])
  )
    return "next-venue-tab";
  if (matchesPredictionKey(event, ["left", "h"], ["h", "\u001b[D", "\u001bOD"]))
    return "previous-category";
  if (
    matchesPredictionKey(event, ["right", "l"], ["l", "\u001b[C", "\u001bOC"])
  )
    return "next-category";
  if (matchesPredictionKey(event, ["w"], ["w"])) return "toggle-watchlist";
  if (matchesPredictionKey(event, ["r"], ["r"])) return "refresh";
  if (matchesPredictionKey(event, ["["], ["["])) return "previous-browse-tab";
  if (matchesPredictionKey(event, ["]"], ["]"])) return "next-browse-tab";
  if (matchesPredictionKey(event, ["1"], ["1"])) return "filter-all";
  if (matchesPredictionKey(event, ["2"], ["2"])) return "filter-watchlist";
  if (matchesPredictionKey(event, ["3"], ["3"])) return "browse-ending";
  if (matchesPredictionKey(event, ["4"], ["4"])) return "browse-new";
  return null;
}
