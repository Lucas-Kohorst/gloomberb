import { useEffect, useRef } from "react";

/**
 * Debounces an async effect and aborts it on cleanup or when the query
 * changes. The callback receives an AbortSignal it can check (or pass to a
 * fetch) to avoid setting state after the user has moved on.
 *
 * `onEnable` runs synchronously when the effect starts (before the debounce),
 * so the caller can set a loading phase or read a cache immediately.
 * `onDisable` runs when the query no longer qualifies, so the caller can
 * clear its state.
 */
export function useDebouncedAbortableEffect(
  query: string,
  enabled: boolean,
  effect: (signal: AbortSignal) => Promise<void>,
  options?: {
    debounceMs?: number;
    onEnable?: () => void;
    onDisable?: () => void;
  },
): void {
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const onEnableRef = useRef(options?.onEnable);
  onEnableRef.current = options?.onEnable;
  const onDisableRef = useRef(options?.onDisable);
  onDisableRef.current = options?.onDisable;
  const debounceMs = options?.debounceMs ?? 200;
  useEffect(() => {
    if (!enabled) {
      onDisableRef.current?.();
      return;
    }
    onEnableRef.current?.();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      effectRef.current(controller.signal).catch(() => {});
    }, debounceMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, enabled, debounceMs]);
}
