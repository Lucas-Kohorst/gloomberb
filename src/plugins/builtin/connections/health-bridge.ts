import type {
  ConnectionHealthKind,
  ConnectionHealthRegistry,
} from "../../../core/connection-health";
import type { ConnectionKind } from "./types";
import {
  listConnectionSources,
  setConnectionRequestReporter,
  subscribeConnectionSources,
  type ConnectionSourceDef,
} from "./register";

interface OwnedRegistration {
  source: ConnectionSourceDef;
  dispose: () => void;
}

function healthKind(kind: ConnectionKind): ConnectionHealthKind {
  if (kind === "asset-data" || kind === "news" || kind === "websocket" || kind === "api") {
    return kind;
  }
  return "api";
}

export function bridgeRegisteredConnectionSources(health: ConnectionHealthRegistry): () => void {
  const owned = new Map<string, OwnedRegistration>();

  const sync = () => {
    const sources = new Map(listConnectionSources().map((source) => [source.id, source]));
    for (const [id, registration] of owned) {
      const source = sources.get(id);
      if (source === registration.source) continue;
      registration.dispose();
      owned.delete(id);
    }
    for (const source of sources.values()) {
      if (owned.has(source.id) || health.hasSource(source.id)) continue;
      owned.set(source.id, {
        source,
        dispose: health.registerSource({
          id: source.id,
          name: source.name,
          kind: healthKind(source.kind),
          ownerId: source.pluginId,
          priority: source.priority,
        }),
      });
    }
  };

  sync();
  const unsubscribe = subscribeConnectionSources(sync);
  setConnectionRequestReporter((id, report) => {
    health.reportRequest(id, {
      operation: report.operation ?? "request",
      success: report.success,
      latencyMs: report.durationMs,
      ...(report.error !== undefined ? { error: report.error } : {}),
    });
  });

  return () => {
    unsubscribe();
    setConnectionRequestReporter(null);
    for (const registration of owned.values()) registration.dispose();
    owned.clear();
  };
}
