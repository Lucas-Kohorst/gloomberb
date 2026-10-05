const HARD_SESSION_INVALID_PATTERNS = [
  /\b(user|account)\b.*\b(not found|deleted|removed|disabled|deactivated|suspended)\b/i,
  /\b(user|account)\b.*\bdoes(?:\s+not|n't)\s+exist\b/i,
  /\b(no|unknown|missing)\s+(user|account)\b/i,
];

export class ApiRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function parseApiErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const parts = [parsed.message, parsed.error, parsed.code, parsed.reason]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return parts.join(" ") || body;
  } catch {
    return body;
  }
}

/** The server refused the session: signed out, expired, or not allowed this resource. */
export function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

/** A client error that retrying will not fix. Timeouts and rate limits pass with time. */
export function isPermanentClientError(error: unknown): boolean {
  const status = error instanceof ApiRequestError ? error.status : undefined;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function isHardSessionInvalidMessage(message: string): boolean {
  const normalized = message.replace(/[_-]+/g, " ");
  return HARD_SESSION_INVALID_PATTERNS.some((pattern) => pattern.test(normalized));
}
