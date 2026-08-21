import {
  isAdjacentCloudChildSourceId,
  resolveConnectionSourceId,
} from "./adjacent-cloud";
import type { ConnectionKind } from "./types";

export interface ConnectionSourceDef {
  id: string;
  name: string;
  kind: ConnectionKind;
  pluginId: string;
  priority?: number;
  isWebSocket?: boolean;
  /** When false, the source has public/keyless endpoints and needs no API key. */
  authRequired?: boolean;
}

export interface ConnectionRequestReport {
  success: boolean;
  durationMs: number;
  operation?: string;
  error?: string;
}

type ConnectionRequestReporter = (id: string, report: ConnectionRequestReport) => void;

const sources = new Map<string, ConnectionSourceDef>();
const listeners = new Set<() => void>();
let reporter: ConnectionRequestReporter | null = null;
/** Reports that arrived before the Connections tracker attached a reporter. */
const pendingReports: Array<{ id: string; report: ConnectionRequestReport }> = [];
const MAX_PENDING_REPORTS = 200;

export function registerConnectionSource(source: ConnectionSourceDef): () => void {
  // Adjacent Cloud children share one inventory row. Callers may still report
  // traffic with the upstream id; `reportConnectionRequest` remaps it.
  if (isAdjacentCloudChildSourceId(source.id)) {
    return () => {};
  }
  sources.set(source.id, source);
  emit();
  return () => {
    if (sources.get(source.id) !== source) return;
    sources.delete(source.id);
    emit();
  };
}

export function listConnectionSources(): ConnectionSourceDef[] {
  return [...sources.values()];
}

export function setConnectionRequestReporter(next: ConnectionRequestReporter | null): void {
  reporter = next;
  if (!next) return;
  if (pendingReports.length === 0) return;
  const queued = pendingReports.splice(0, pendingReports.length);
  for (const entry of queued) {
    next(entry.id, entry.report);
  }
}

export function reportConnectionRequest(id: string, report: ConnectionRequestReport): void {
  const sourceId = resolveConnectionSourceId(id);
  if (reporter) {
    reporter(sourceId, report);
    return;
  }
  pendingReports.push({ id: sourceId, report });
  if (pendingReports.length > MAX_PENDING_REPORTS) {
    pendingReports.splice(0, pendingReports.length - MAX_PENDING_REPORTS);
  }
}

export async function withConnectionRequest<T>(
  id: string,
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await run();
    reportConnectionRequest(id, {
      success: true,
      durationMs: Date.now() - start,
      operation,
    });
    return result;
  } catch (error) {
    reportConnectionRequest(id, {
      success: false,
      durationMs: Date.now() - start,
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function subscribeConnectionSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: drain any buffered reports without attaching a reporter. */
export function clearPendingConnectionReports(): void {
  pendingReports.length = 0;
}

function emit(): void {
  for (const listener of listeners) listener();
}
