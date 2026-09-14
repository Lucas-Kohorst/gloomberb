type ProcessLike = { env?: Record<string, string | undefined> };

function processLike(): ProcessLike | undefined {
  try {
    return (globalThis as { process?: ProcessLike }).process;
  } catch {
    return undefined;
  }
}

/** Env map without naming the `process` identifier (JSC throws on a free `process`). */
export function processEnvRecord(): Record<string, string | undefined> {
  return processLike()?.env ?? {};
}

/** Read a process env var. Safe in desktop/web where `process` is missing. */
export function readProcessEnv(name: string): string | undefined {
  const value = processEnvRecord()[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
