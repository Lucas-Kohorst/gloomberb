import { useCallback, useSyncExternalStore } from "react";
import type { NativeRendererHost } from "../../ui";

export interface OpenTuiViewportSize {
  width: number;
  height: number;
}

interface ViewportHub {
  snapshot: OpenTuiViewportSize;
  consumers: Set<() => void>;
  attached: boolean;
  refresh: () => void;
}

const viewportHubs = new WeakMap<NativeRendererHost, ViewportHub>();

function readViewport(renderer: NativeRendererHost): OpenTuiViewportSize {
  return {
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
  };
}

function sameSize(left: OpenTuiViewportSize, right: OpenTuiViewportSize): boolean {
  return left.width === right.width && left.height === right.height;
}

function getViewportHub(renderer: NativeRendererHost): ViewportHub {
  let hub = viewportHubs.get(renderer);
  if (hub) return hub;

  hub = {
    snapshot: readViewport(renderer),
    consumers: new Set(),
    attached: false,
    refresh: () => {},
  };
  hub.refresh = () => {
    const next = readViewport(renderer);
    if (sameSize(hub!.snapshot, next)) return;
    hub!.snapshot = next;
    for (const notify of hub!.consumers) notify();
  };
  viewportHubs.set(renderer, hub);
  return hub;
}

/**
 * One CliRenderer `resize` listener for every `useViewport()` consumer.
 * Each table/header/shell used to attach its own OpenTUI resize hook, which
 * stacked past MaxListeners(10) as soon as a layout had more than a handful
 * of panes.
 */
export function subscribeOpenTuiViewport(
  renderer: NativeRendererHost,
  onStoreChange: () => void,
): () => void {
  const hub = getViewportHub(renderer);
  const wasEmpty = hub.consumers.size === 0;
  hub.consumers.add(onStoreChange);

  if (wasEmpty && !hub.attached) {
    hub.attached = true;
    renderer.on("resize", hub.refresh);
    hub.refresh();
  }

  return () => {
    hub.consumers.delete(onStoreChange);
    if (hub.consumers.size === 0 && hub.attached) {
      renderer.off("resize", hub.refresh);
      hub.attached = false;
    }
  };
}

export function getOpenTuiViewportSnapshot(renderer: NativeRendererHost): OpenTuiViewportSize {
  return getViewportHub(renderer).snapshot;
}

export function useOpenTuiViewport(renderer: NativeRendererHost): OpenTuiViewportSize {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeOpenTuiViewport(renderer, onStoreChange),
    [renderer],
  );
  const getSnapshot = useCallback(
    () => getOpenTuiViewportSnapshot(renderer),
    [renderer],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
