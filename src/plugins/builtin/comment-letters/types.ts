export const COMMENT_LETTERS_PLUGIN_ID = "comment-letters";
export const COMMENT_LETTERS_PANE_ID = "comment-letters";

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

/** One filing the parser accepts before it becomes a comment letter. */
export interface CommentLetterFiling {
  accessionNumber: string;
  form: string;
  filingDate: Date;
  cik: string;
  companyName?: string;
  ticker?: string;
  filingUrl: string;
  primaryDocumentUrl?: string;
  primaryDocDescription?: string;
  items?: string;
}

/** A table row the pane renders from a comment letter. */
export interface CommentLetterRow {
  id: string;
  form: string;
  company: string;
  ticker: string;
  cik: string;
  filed: string;
  filedAt: number;
  severity: CommentLetterSeverity;
  severityLabel: string;
  score: number;
  topic: string;
  reasons: string[];
  url: string | null;
}

const SEVERITY_ORDER: Record<CommentLetterSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export const severityRank = (level: CommentLetterSeverity): number => SEVERITY_ORDER[level] ?? 0;

export const severityTag = (level: CommentLetterSeverity): string => {
  switch (level) {
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
  }
};
