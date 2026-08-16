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

export function registerConnectionSource(source: ConnectionSourceDef): () => void {
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
}

export function reportConnectionRequest(id: string, report: ConnectionRequestReport): void {
  reporter?.(id, report);
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

function emit(): void {
  for (const listener of listeners) listener();
}
