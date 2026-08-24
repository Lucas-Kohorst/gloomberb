import type { AssistCommandCandidate } from "../../../api-client";
import { t } from "../../../i18n";
import type { ResultItem } from "../list/model";

/** Marker shown on every AI-resolved row, matching the AI plugin's iconography. */
const ASSIST_GLYPH = "✦";

/** Category heading the assist rows group under; sorted first by the view model. */
const ASSIST_CATEGORY = "Ask AI";

/** Shorter queries are almost always a half-typed prefix, not a question. */
const ASSIST_AUTO_MIN_QUERY_LENGTH = 3;

/** 1–5 letter symbols, plus share-class forms like BRK.B / BF.A. */
const TICKER_LIKE_QUERY = /^[A-Za-z]{1,5}(?:[.=][A-Za-z0-9]{1,4})?$/;

/** True when the query is a ticker token, not a question for Ask AI. */
export function looksLikeTickerQuery(query: string): boolean {
  return TICKER_LIKE_QUERY.test(query.trim());
}

/** Plain root queries that should resolve securities on the ticker index. */
export function shouldPlainRootTickerSearch(query: string): boolean {
  return looksLikeTickerQuery(query);
}

export type AssistErrorKind = "unavailable" | "rate-limited" | "failed";

/** Whether the request was started by the debounce or by the user hitting Enter. */
export type AssistRequestSource = "auto" | "explicit";

export type AssistRequestState =
  | { status: "idle" }
  | { status: "loading"; query: string; source: AssistRequestSource }
  | { status: "answered"; query: string; source: AssistRequestSource; candidates: AssistCommandCandidate[] }
  | { status: "error"; query: string; source: AssistRequestSource; kind: AssistErrorKind };

export interface AssistRowHandlers {
  /** Signed in with a verified email, i.e. `/assist/command` will answer. */
  enabled: boolean;
  /** The query qualifies for a background ask, so the section is expected. */
  auto: boolean;
  state: AssistRequestState;
  onAsk: () => void;
  onSignUp: () => void;
  onRunCandidate: (input: string, prefix?: string) => void;
}

/**
 * Whether the query should be answered by the AI without being asked for it.
 * Anything the prefix parser recognizes is the user speaking the command
 * language, and very short input is a prefix mid-typing rather than a question.
 */
export function shouldAutoAskAssist({
  query,
  hasShortcutIntent,
}: {
  query: string;
  hasShortcutIntent: boolean;
}): boolean {
  if (hasShortcutIntent) return false;
  const trimmed = query.trim();
  if (trimmed.length < ASSIST_AUTO_MIN_QUERY_LENGTH) return false;
  if (looksLikeTickerQuery(trimmed)) return false;
  return true;
}

/**
 * Whether a signed-out user is offered the sign-up row. Multi-word input reads
 * as natural language rather than a prefix, and a query with no local matches
 * is a dead end either way.
 */
export function shouldShowAssistRow({
  query,
  resultCount,
}: {
  query: string;
  resultCount: number;
}): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (/\s/.test(trimmed)) return true;
  return resultCount === 0;
}

function assistErrorLabel(kind: AssistErrorKind): string {
  if (kind === "unavailable") return t("AI assist unavailable");
  if (kind === "rate-limited") return t("Rate limited — try again in a minute");
  return t("AI assist failed — try again");
}

function assistRow(options: {
  id: string;
  label: string;
  kind: ResultItem["kind"];
  action?: () => void;
  defaultSelectable?: boolean;
}): ResultItem {
  return {
    id: options.id,
    label: options.label,
    detail: "",
    category: ASSIST_CATEGORY,
    kind: options.kind,
    // Right-aligned like a shortcut, so the glyph never crowds the answer.
    right: ASSIST_GLYPH,
    accent: true,
    disabled: !options.action,
    defaultSelectable: options.defaultSelectable,
    action: options.action ?? (() => {}),
  };
}

/**
 * Rows for the assist section. They group under Ask AI, which leads natural-
 * language queries; ticker matches sort above it.
 */
export function buildAssistResultItems({
  query,
  enabled,
  auto,
  state,
  onAsk,
  onSignUp,
  onRunCandidate,
  hasLocalResults = false,
}: AssistRowHandlers & { query: string; hasLocalResults?: boolean }): ResultItem[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (!enabled) {
    // An offer, not an answer: it leads the list without ever taking the Enter
    // that belongs to the local match the user is looking at.
    return [assistRow({
      id: "assist:sign-up",
      label: t("Ask AI — sign up to enable"),
      kind: "action",
      action: onSignUp,
      defaultSelectable: false,
    })];
  }

  // A response only describes the query it was asked about.
  const active = state.status !== "idle" && state.query === trimmed ? state : null;

  if (!active) {
    if (!auto) return [];
    // Still inside the debounce window; activating the row skips the wait.
    return [assistRow({ id: "assist:pending", label: t("Thinking…"), kind: "info", action: onAsk })];
  }

  if (active.status === "loading") {
    // Selected by default while it leads the list, so Enter has to mean
    // something: it claims the answer that is already on the wire.
    return [assistRow({ id: "assist:loading", label: t("Thinking…"), kind: "info", action: onAsk })];
  }

  if (active.status === "error") {
    // A background failure is not worth a row the user never asked for.
    if (active.source === "auto") return [];
    return [assistRow({
      id: "assist:error",
      label: assistErrorLabel(active.kind),
      kind: "info",
      action: onAsk,
      defaultSelectable: false,
    })];
  }

  if (active.candidates.length === 0) {
    // Local article/command hits already answer the query; don't bury them
    // under a dead-end AI row.
    if (hasLocalResults) return [];
    return [assistRow({
      id: "assist:no-command",
      label: t("No command found — try HELP"),
      kind: "info",
    })];
  }

  // Title in the label, prefix as the trailing chip — never "DES AAPL — …".
  return active.candidates.map((candidate, index) => {
    const prefix = candidate.prefix?.trim();
    return {
      ...assistRow({
        id: `assist:candidate:${index}:${candidate.input}`,
        label: candidate.title,
        kind: "action",
        action: () => onRunCandidate(candidate.input, candidate.prefix),
      }),
      right: prefix ? `${prefix}  ${ASSIST_GLYPH}` : ASSIST_GLYPH,
    };
  });
}
