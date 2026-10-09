import { useEffect, useRef } from "react";
import { usePluginPaneState } from "../../../public/react";
import { usePaneInstance } from "../../../state/app/context";
import type { PaneTemplateDef, PaneTemplateInstanceConfig } from "../../../types/plugin";

/** A command's request to show one tab, stamped so a later command can ask again. */
export function commandTabParams(tab: string, params?: Record<string, string>): Record<string, string> {
  return { ...(params ?? {}), tab, tabAt: String(Date.now()) };
}

/** The template's pane, with the command's tab written onto the instance. */
function stampCommandTab(instance: PaneTemplateInstanceConfig | null, tab: string): PaneTemplateInstanceConfig | null {
  return instance ? { ...instance, params: commandTabParams(tab, instance.params) } : null;
}

export function withCommandTab(template: PaneTemplateDef, tab: string): PaneTemplateDef {
  const create = template.createInstance;
  return {
    ...template,
    createInstance: (context, options) => {
      const created = create?.(context, options);
      if (!created) return null;
      return created instanceof Promise ? created.then((instance) => stampCommandTab(instance, tab)) : stampCommandTab(created, tab);
    },
  };
}

/**
 * The tab a command asked this pane to show. A stored choice wins until a
 * newer command arrives. Another pane's params, such as Ticker Research
 * around a nested tab, are ignored.
 */
export function useCommandTab<T extends string>(
  paneId: string,
  stateKey: string,
  tabs: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const instance = usePaneInstance();
  const params = instance?.paneId === paneId ? instance.params : undefined;
  const requested = params && (tabs as readonly string[]).includes(params.tab ?? "") ? params.tab as T : null;
  const requestAt = params?.tabAt ?? "";
  const [tab, setTab] = usePluginPaneState<T>(stateKey, requested ?? fallback);
  const seen = useRef(requestAt);
  useEffect(() => {
    if (!requested || requestAt === seen.current) return;
    seen.current = requestAt;
    setTab(requested);
  }, [requestAt, requested, setTab]);
  return [tab, setTab];
}
