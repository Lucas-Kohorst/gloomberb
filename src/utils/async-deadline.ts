export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: (error: OperationTimeoutError) => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new OperationTimeoutError(message);
      reject(error);
      onTimeout?.(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** The error fetch and other cancellable work reject with once aborted. */
export function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

/** Settles with the promise, or rejects once the signal fires. The work itself keeps running. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, message: string): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(message));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function settleWithinBudget(
  promise: Promise<void>,
  timeoutMs: number,
  message: string,
  onFailure?: (error: unknown) => void,
): Promise<void> {
  try {
    await withDeadline(promise, timeoutMs, message);
  } catch (error) {
    onFailure?.(error);
  }
}
