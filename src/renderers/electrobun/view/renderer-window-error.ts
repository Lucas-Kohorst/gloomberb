export type RendererWindowErrorDecision = "fatal" | "ignore";

const RESIZE_OBSERVER_LOOP = /resizeobserver loop/i;

export function isBenignRendererWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return RESIZE_OBSERVER_LOOP.test(message);
}

export function resolveRendererWindowError(input: {
  error: unknown;
  details?: string;
  source?: string;
  appMounted: boolean;
}): RendererWindowErrorDecision {
  if (isBenignRendererWindowError(input.error) || isBenignRendererWindowError(input.details)) {
    return "ignore";
  }
  if (input.appMounted && input.source === "unhandledrejection") {
    return "ignore";
  }
  return "fatal";
}
