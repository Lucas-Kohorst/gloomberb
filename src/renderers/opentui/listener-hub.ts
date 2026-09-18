/**
 * OpenTUI ScrollBox attaches one `selection` listener per instance, and each
 * `useViewport()` / `useTerminalDimensions()` caller attaches its own `resize`
 * listener. A multi-pane layout crosses EventEmitter's default MaxListeners(10),
 * which dumps `MaxListenersExceededWarning` into the live TUI grid.
 *
 * Teardown already exists (ScrollBox.destroySelf, useOnResize cleanup). The
 * failure is fan-out, not a missing off(). Multiplex those two events through
 * one real emitter listener each so Node never paints the warning.
 */

export const CLI_RENDERER_HUBBED_EVENTS = ["selection", "resize"] as const;

type HubbedEvent = (typeof CLI_RENDERER_HUBBED_EVENTS)[number];
type EmitterHandler = (...args: any[]) => void;
type EmitterMethod = (event: string | symbol, handler: EmitterHandler) => unknown;

export interface ListenerHubEmitter {
  on: EmitterMethod;
  off: EmitterMethod;
  addListener?: EmitterMethod;
  removeListener?: EmitterMethod;
  once?: EmitterMethod;
}

const HUBBED_EVENT_SET = new Set<string>(CLI_RENDERER_HUBBED_EVENTS);

function isHubbedEvent(event: string | symbol): event is HubbedEvent {
  return typeof event === "string" && HUBBED_EVENT_SET.has(event);
}

export function installCliRendererListenerHub<T extends ListenerHubEmitter>(emitter: T): T {
  const originalOn = emitter.on.bind(emitter) as EmitterMethod;
  const originalOff = emitter.off.bind(emitter) as EmitterMethod;
  const originalOnce = emitter.once?.bind(emitter) as EmitterMethod | undefined;

  const handlers = new Map<HubbedEvent, EmitterHandler[]>();
  const dispatchers = new Map<HubbedEvent, EmitterHandler>();

  function dispatcherFor(event: HubbedEvent): EmitterHandler {
    const existing = dispatchers.get(event);
    if (existing) return existing;
    const dispatch: EmitterHandler = (...args) => {
      const list = handlers.get(event);
      if (!list || list.length === 0) return;
      for (const handler of list.slice()) {
        handler(...args);
      }
    };
    dispatchers.set(event, dispatch);
    return dispatch;
  }

  function add(event: string | symbol, handler: EmitterHandler) {
    if (!isHubbedEvent(event)) return originalOn(event, handler);
    const list = handlers.get(event) ?? [];
    if (list.length === 0) {
      originalOn(event, dispatcherFor(event));
    }
    list.push(handler);
    handlers.set(event, list);
    return emitter;
  }

  function remove(event: string | symbol, handler: EmitterHandler) {
    if (!isHubbedEvent(event)) return originalOff(event, handler);
    const list = handlers.get(event);
    if (!list) return emitter;
    const index = list.indexOf(handler);
    if (index < 0) return emitter;
    list.splice(index, 1);
    if (list.length === 0) {
      handlers.delete(event);
      originalOff(event, dispatcherFor(event));
    }
    return emitter;
  }

  function once(event: string | symbol, handler: EmitterHandler) {
    if (!isHubbedEvent(event)) {
      return originalOnce ? originalOnce(event, handler) : originalOn(event, handler);
    }
    const wrapped: EmitterHandler = (...args) => {
      remove(event, wrapped);
      handler(...args);
    };
    return add(event, wrapped);
  }

  emitter.on = add;
  emitter.off = remove;
  emitter.addListener = add;
  emitter.removeListener = remove;
  emitter.once = once;
  return emitter;
}
