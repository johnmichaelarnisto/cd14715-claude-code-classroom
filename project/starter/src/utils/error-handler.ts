export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    Error.captureStackTrace(this, ReviewError);
  }
}

export const ErrorCodes = {
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode =
  typeof ErrorCodes[keyof typeof ErrorCodes];

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const backoff =
          delayMs * Math.pow(2, attempt - 1);

        const jitter = Math.random() * 100;

        await new Promise<void>((resolve) =>
          setTimeout(resolve, backoff + jitter)
        );
      }
    }
  }

  throw new ReviewError(
    'Retry attempts exhausted',
    ErrorCodes.RETRY_EXHAUSTED,
    {
      maxRetries,
      cause:
        lastError instanceof Error
          ? lastError.message
          : String(lastError)
    }
  );
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ReviewError(
          errorMessage,
          ErrorCodes.AGENT_TIMEOUT,
          { timeoutMs }
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fn(),
      timeoutPromise
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function isReviewError(
  error: unknown
): error is ReviewError {
  return error instanceof ReviewError;
}

export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}