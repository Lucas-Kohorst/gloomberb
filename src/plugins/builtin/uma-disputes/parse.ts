import type {
  UmaDisputeStage,
  UmaQuestion,
  UmaRecentPage,
  UmaStageEvent,
} from "./types";

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseStage(value: unknown): UmaStageEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    proposer: asString(record.proposer),
    disputer: asString(record.disputer),
    answer: asString(record.answer),
    priceRaw: asString(record.price_raw),
    requestTs: asNumber(record.request_ts),
    block: asNumber(record.block),
    tx: asString(record.tx),
    logIndex: asNumber(record.log_index),
    seenPending: record.seen_pending === true,
    payout: asString(record.payout),
  };
}

export function parseUmaQuestion(value: unknown, fromDisputedFeed = false): UmaQuestion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const questionId = asString(record.question_id);
  if (!questionId) return null;
  return {
    questionId,
    conditionId: asString(record.condition_id) ?? "",
    title: asString(record.title) ?? "Untitled market",
    answer: asString(record.answer) ?? "",
    settled: record.settled === true,
    proposed: parseStage(record.proposed),
    disputed: parseStage(record.disputed),
    settledAt: parseStage(record.settled_at),
    updatedMs: asNumber(record.updated_ms) ?? 0,
    fromDisputedFeed,
  };
}

/** `GET /uma/recent` body: `{ questions, count }`. */
export function parseUmaRecentPage(payload: unknown, fromDisputedFeed = false): UmaRecentPage {
  if (!payload || typeof payload !== "object") return { questions: [], count: 0 };
  const record = payload as Record<string, unknown>;
  const raw = Array.isArray(record.questions) ? record.questions : [];
  const questions = raw.flatMap((entry) => {
    const question = parseUmaQuestion(entry, fromDisputedFeed);
    return question ? [question] : [];
  });
  const count = asNumber(record.count) ?? questions.length;
  return { questions, count };
}

/**
 * A dispute is a question Bravado marked disputed, or a row from the
 * `stage=disputed` feed. Settled questions count only when they carry a
 * `disputed` object — an undisputed settlement is not a dispute.
 */
export function disputeStage(question: UmaQuestion): UmaDisputeStage | null {
  const wasDisputed = question.disputed != null || question.fromDisputedFeed;
  if (!wasDisputed) return null;
  if (question.settled || question.settledAt) return "settled";
  if (question.disputed?.seenPending) return "pending";
  return "disputed";
}

export function isUmaDispute(question: UmaQuestion): boolean {
  return disputeStage(question) != null;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Polygonscan page for the dispute transaction, else the proposal transaction. */
export function disputeTxUrl(question: UmaQuestion): string | null {
  const tx = question.disputed?.tx ?? question.proposed?.tx ?? "";
  if (!TX_HASH.test(tx)) return null;
  return `https://polygonscan.com/tx/${tx}`;
}

export function disputesFromPages(pages: readonly UmaQuestion[]): UmaQuestion[] {
  const byId = new Map<string, UmaQuestion>();
  for (const question of pages) {
    if (!isUmaDispute(question)) continue;
    const existing = byId.get(question.questionId);
    if (!existing) {
      byId.set(question.questionId, question);
      continue;
    }
    const existingUpdated = existing.updatedMs;
    const nextUpdated = question.updatedMs;
    if (nextUpdated >= existingUpdated) byId.set(question.questionId, {
      ...question,
      fromDisputedFeed: existing.fromDisputedFeed || question.fromDisputedFeed,
    });
  }
  return [...byId.values()].sort((left, right) => right.updatedMs - left.updatedMs);
}
