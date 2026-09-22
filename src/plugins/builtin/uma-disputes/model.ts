import { applySortPreference, type SortPreference } from "../../../utils/sort-values";
import { disputeStage, disputeTxUrl } from "./parse";
import type { UmaDisputeColumnId, UmaQuestion } from "./types";

export type UmaSort = SortPreference<UmaDisputeColumnId>;

export function disputeSortValue(question: UmaQuestion, columnId: UmaDisputeColumnId): string | number {
  switch (columnId) {
    case "title":
      return question.title;
    case "answer":
      return question.disputed?.answer || question.answer;
    case "disputer":
      return question.disputed?.disputer ?? "";
    case "updated":
      return question.updatedMs || question.disputed?.requestTs || 0;
    case "stage":
      return disputeStage(question) ?? "";
  }
}

export function sortDisputes(questions: readonly UmaQuestion[], sort: UmaSort): UmaQuestion[] {
  return applySortPreference(questions, sort, disputeSortValue);
}

export function filterDisputes(questions: readonly UmaQuestion[], query: string): UmaQuestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...questions];
  return questions.filter((question) => {
    const haystack = [
      question.title,
      question.answer,
      question.questionId,
      question.conditionId,
      question.disputed?.disputer,
      question.disputed?.answer,
      question.proposed?.proposer,
      disputeStage(question),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function shortAddress(value: string | undefined): string {
  if (!value) return "—";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatUpdated(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(5, 16).replace("T", " ");
}

export function formatAnswer(question: UmaQuestion): string {
  return question.disputed?.answer || question.answer || "—";
}

export { disputeTxUrl };
