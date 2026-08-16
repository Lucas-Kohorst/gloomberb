import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { RemoteUiNodeSnapshot } from "./types";

type RemoteUiAction = (input?: unknown) => unknown | Promise<unknown>;

export interface RemoteUiNodeRegistration {
  role: string;
  label?: string;
  disabled?: boolean;
  actions?: Record<string, RemoteUiAction | undefined>;
  metadata?: Record<string, unknown>;
}

interface RegisteredRemoteUiNode extends RemoteUiNodeRegistration {
  id: string;
  actions: Record<string, RemoteUiAction>;
}

export interface RemoteUiRegistry {
  register(id: string, registration: RemoteUiNodeRegistration): void;
  unregister(id: string): void;
  snapshot(): RemoteUiNodeSnapshot[];
  invoke(nodeId: string, action: string, input?: unknown): Promise<unknown>;
}

const RemoteUiRegistryContext = createContext<RemoteUiRegistry | null>(null);

function createRemoteUiRegistry(): RemoteUiRegistry {
  const nodes = new Map<string, RegisteredRemoteUiNode>();

  return {
    register(id, registration) {
      nodes.set(id, {
        ...registration,
        id,
        actions: Object.fromEntries(
          Object.entries(registration.actions ?? {})
            .filter((entry): entry is [string, RemoteUiAction] => typeof entry[1] === "function"),
        ),
      });
    },
    unregister(id) {
      nodes.delete(id);
    },
    snapshot() {
      return [...nodes.values()].map((node) => ({
        id: node.id,
        role: node.role,
        label: node.label,
        disabled: node.disabled,
        actions: Object.keys(node.actions).sort(),
        metadata: node.metadata,
      }));
    },
    async invoke(nodeId, action, input) {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`Unknown UI node "${nodeId}".`);
      if (node.disabled) throw new Error(`UI node "${nodeId}" is disabled.`);
      const handler = node.actions[action];
      if (!handler) throw new Error(`UI node "${nodeId}" does not expose action "${action}".`);
      return await handler(input);
    },
  };
}

export function RemoteUiRegistryProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef<RemoteUiRegistry | null>(null);
  if (!registryRef.current) {
    registryRef.current = createRemoteUiRegistry();
  }
  return (
    <RemoteUiRegistryContext value={registryRef.current}>
      {children}
    </RemoteUiRegistryContext>
  );
}

export function useRemoteUiRegistry(): RemoteUiRegistry | null {
  return useContext(RemoteUiRegistryContext);
}

export function useRemoteUiNode(registration: RemoteUiNodeRegistration | null | undefined): string | null {
  // The registration effect is keyed on `registration` identity. Callers must
  // pass a memoized registration object (useMemo) — an inline literal would
  // create a new object every render and re-register on every commit.
  const registry = useRemoteUiRegistry();
  const generatedId = useId();
  const nodeId = useMemo(() => `ui:${generatedId.replace(/:/g, "")}`, [generatedId]);

  useEffect(() => {
    if (!registry) return;
    if (!registration) {
      registry.unregister(nodeId);
      return;
    }
    registry.register(nodeId, registration);
  }, [registry, nodeId, registration]);

  useEffect(() => {
    return () => registry?.unregister(nodeId);
  }, [
    nodeId,
    registry,
  ]);

  return registry && registration ? nodeId : null;
}
