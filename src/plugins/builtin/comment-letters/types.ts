export const COMMENT_LETTERS_PLUGIN_ID = "comment-letters";
export const COMMENT_LETTERS_CONNECTION_ID = "sec-comment-letters";

/** EDGAR informal-correspondence forms that make up an SEC comment-letter file. */
export const COMMENT_LETTER_FORMS = ["CORRESP", "UPLOAD"] as const;

export type CommentLetterSeverity = "high" | "medium" | "low";

export interface SeverityAssessment {
  level: CommentLetterSeverity;
  /** Sum of matched keyword weights. Thresholds: >= 6 high, >= 2 medium. */
  score: number;
  /** Human-readable matched signals, most significant first. */
  reasons: string[];
}

/** One SEC comment-letter filing (staff letter or company response). */
export interface CommentLetter {
  id: string;
  form: string;
  companyName?: string;
  ticker?: string;
  cik: string;
  accessionNumber: string;
  filingDate: Date;
  filingUrl: string;
  primaryDocumentUrl?: string;
  description?: string;
  severity: CommentLetterSeverity;
  severityScore: number;
  severityReasons: string[];
}

export interface CommentLettersPage {
  letters: CommentLetter[];
  total: number;
}

export const SEVERITY_ORDER: Record<CommentLetterSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function severityRank(level: CommentLetterSeverity): number {
  return SEVERITY_ORDER[level] ?? 0;
}

export function severityTag(level: CommentLetterSeverity): string {
  switch (level) {
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
  }
}
