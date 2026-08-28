import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DEFAULT_RUNS_DIR = join(homedir(), ".gloomberb", "ai-runs");
const PREVIEW_CHARS = 4_000;

let runsDirOverride: string | null = null;

export function getAiRunsDir(): string {
  return runsDirOverride ?? DEFAULT_RUNS_DIR;
}

export function setAiRunsDirForTests(dir: string | null): void {
  runsDirOverride = dir;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function previewText(text: string, max = PREVIEW_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[${text.length - max} more chars]`;
}

export interface AiRunTrace {
  id: string;
  timestamp: number;
  providerId: string;
  modelId?: string;
  outputMode?: string;
  cwd?: string;
  command?: string[];
  promptChars: number;
  estimatedTokens: number;
  systemPromptChars?: number;
  historyChars?: number;
  promptPreview: string;
  stdoutPreview?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs: number;
  error?: string;
  files?: { prompt?: string; jsonl?: string };
}

function ensureRunsDir(dir = getAiRunsDir()): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeAiRunPromptFile(id: string, prompt: string, dir = getAiRunsDir()): string {
  const path = join(ensureRunsDir(dir), `${id}.prompt.txt`);
  writeFileSync(path, prompt, "utf8");
  return path;
}

export function writeAiRunTrace(trace: AiRunTrace, dir = getAiRunsDir()): string {
  const root = ensureRunsDir(dir);
  const jsonlPath = join(root, "runs.jsonl");
  const lastPath = join(root, "last.json");
  const record = {
    ...trace,
    files: {
      ...trace.files,
      jsonl: jsonlPath,
    },
  };
  appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, "utf8");
  writeFileSync(lastPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return lastPath;
}

export function formatTracedError(error: unknown, tracePath: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const overflow = /maximum prompt length|context length|too many tokens/i.test(raw);
  const detail = overflow
    ? `Prompt exceeded the model window. ${raw} Request/response log: ${tracePath}`
    : `${raw} Request/response log: ${tracePath}`;
  const next = new Error(detail);
  if (error instanceof Error) next.cause = error;
  return next;
}
