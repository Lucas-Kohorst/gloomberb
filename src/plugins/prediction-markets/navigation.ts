import {
  PREDICTION_CATEGORY_OPTIONS,
  type PredictionCategoryId,
} from "./categories";
import type {
  PredictionBrowseTab,
  PredictionDetailTab,
  PredictionVenueScope,
} from "./types";

export const VENUE_TABS: ReadonlyArray<{
  label: string;
  value: PredictionVenueScope;
}> = [
  { label: "All venues", value: "all" },
  { label: "Polymarket", value: "polymarket" },
  { label: "Kalshi", value: "kalshi" },
];

export const BROWSE_TABS: ReadonlyArray<{
  label: string;
  value: PredictionBrowseTab;
}> = [
  { label: "Top", value: "top" },
  { label: "Ending", value: "ending" },
  { label: "New", value: "new" },
];

/** One chip row: All, Watchlist, Ending, New, then topic categories. */
export type PredictionFilterId = PredictionCategoryId | "ending" | "new";

export interface PredictionFilterTab {
  id: PredictionFilterId;
  label: string;
  categoryId: PredictionCategoryId;
  browseTab: PredictionBrowseTab;
}

const TOPIC_CATEGORY_OPTIONS = PREDICTION_CATEGORY_OPTIONS.filter(
  (option) => option.id !== "all" && option.id !== "watchlist",
);

export const PREDICTION_FILTER_TABS: readonly PredictionFilterTab[] = [
  { id: "all", label: "All", categoryId: "all", browseTab: "top" },
  { id: "watchlist", label: "Watchlist", categoryId: "watchlist", browseTab: "top" },
  { id: "ending", label: "Ending", categoryId: "all", browseTab: "ending" },
  { id: "new", label: "New", categoryId: "all", browseTab: "new" },
  ...TOPIC_CATEGORY_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    categoryId: option.id,
    browseTab: "top" as const,
  })),
];

export function resolvePredictionFilterId(
  categoryId: PredictionCategoryId,
  browseTab: PredictionBrowseTab,
): PredictionFilterId {
  if (categoryId === "all" && browseTab === "ending") return "ending";
  if (categoryId === "all" && browseTab === "new") return "new";
  return categoryId;
}

export function predictionFilterTab(
  filterId: PredictionFilterId,
): PredictionFilterTab {
  return PREDICTION_FILTER_TABS.find((tab) => tab.id === filterId)
    ?? PREDICTION_FILTER_TABS[0]!;
}

export function getAdjacentPredictionFilterId(
  current: PredictionFilterId,
  direction: "previous" | "next",
  options?: { wrap?: boolean },
): PredictionFilterId {
  const currentIndex = PREDICTION_FILTER_TABS.findIndex((tab) => tab.id === current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const lastIndex = PREDICTION_FILTER_TABS.length - 1;
  const nextIndex = options?.wrap
    ? direction === "previous"
      ? (safeIndex - 1 + PREDICTION_FILTER_TABS.length) % PREDICTION_FILTER_TABS.length
      : (safeIndex + 1) % PREDICTION_FILTER_TABS.length
    : direction === "previous"
      ? Math.max(safeIndex - 1, 0)
      : Math.min(safeIndex + 1, lastIndex);
  return PREDICTION_FILTER_TABS[nextIndex]!.id;
}

export function cyclePredictionFilterId(
  current: PredictionFilterId,
  direction: "previous" | "next",
): PredictionFilterId {
  return getAdjacentPredictionFilterId(current, direction, { wrap: true });
}

export const DETAIL_TABS: ReadonlyArray<{
  label: string;
  value: PredictionDetailTab;
}> = [
  { label: "Overview", value: "overview" },
  { label: "Chart", value: "chart" },
  { label: "Book", value: "book" },
  { label: "Trades", value: "trades" },
  { label: "Rules", value: "rules" },
  { label: "Data", value: "data" },
  { label: "Similar", value: "similar" },
  { label: "News", value: "news" },
];

const LIVE_DETAIL_TABS = new Set<PredictionDetailTab>([
  "overview",
  "chart",
  "book",
  "trades",
]);

/** Rules, data, similar, and news are static, so they should not drive venue polling. */
export function isLivePredictionDetailTab(tab: PredictionDetailTab): boolean {
  return LIVE_DETAIL_TABS.has(tab);
}

export function parsePredictionVenueScope(
  value: string | undefined,
): PredictionVenueScope | null {
  if (value === "all" || value === "polymarket" || value === "kalshi") {
    return value;
  }
  return null;
}

export function parsePredictionSearchShortcut(query: string): {
  venueScope: PredictionVenueScope;
  searchQuery: string;
} {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("polymarket:")) {
    return {
      venueScope: "polymarket",
      searchQuery: trimmed.slice("polymarket:".length).trim(),
    };
  }
  if (lower.startsWith("kalshi:")) {
    return {
      venueScope: "kalshi",
      searchQuery: trimmed.slice("kalshi:".length).trim(),
    };
  }
  return { venueScope: "all", searchQuery: trimmed };
}

export function getAdjacentPredictionVenueScope(
  current: PredictionVenueScope,
  direction: "previous" | "next",
): PredictionVenueScope {
  const currentIndex = VENUE_TABS.findIndex((tab) => tab.value === current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex =
    direction === "previous"
      ? Math.max(safeIndex - 1, 0)
      : Math.min(safeIndex + 1, VENUE_TABS.length - 1);
  return VENUE_TABS[nextIndex]!.value;
}

export function getAdjacentPredictionBrowseTab(
  current: PredictionBrowseTab,
  direction: "previous" | "next",
): PredictionBrowseTab {
  const currentIndex = BROWSE_TABS.findIndex((tab) => tab.value === current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex =
    direction === "previous"
      ? (safeIndex - 1 + BROWSE_TABS.length) % BROWSE_TABS.length
      : (safeIndex + 1) % BROWSE_TABS.length;
  return BROWSE_TABS[nextIndex]!.value;
}
