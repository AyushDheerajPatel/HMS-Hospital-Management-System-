export function isRetryableSyncStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function isRetryableSyncError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"));
}

export function isOperationOwnedBySession(
  operation: { tenantId: string; userId?: string },
  tenantId: string,
  userId: string,
): boolean {
  return operation.tenantId === tenantId && operation.userId === userId;
}

export function parseRetryAfterMs(
  retryAfter: string | null,
  now = Date.now(),
): number | undefined {
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(retryAfter);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - now)
    : undefined;
}

export function getSyncRetryDelayMs(
  retryCount: number,
  random: () => number = Math.random,
  retryAfterMs = 0,
): number {
  const exponent = Math.max(0, Math.min(retryCount, 8));
  const baseDelay = Math.min(1000 * 2 ** exponent, 5 * 60 * 1000);
  const jitter = Math.min(1, Math.max(0, random()));
  return Math.max(
    Math.min(
      Math.round(baseDelay * (0.5 + jitter)),
      5 * 60 * 1000,
    ),
    Math.max(0, retryAfterMs),
  );
}
