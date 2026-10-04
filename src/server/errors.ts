/** Invalid input that is not a zod schema failure (e.g. a CSV without the required columns). → HTTP 400 */
export class BadRequestError extends Error {
  readonly code = "BAD_REQUEST";
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Too many requests for an API token / client. → HTTP 429 with Retry-After */
export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  constructor(readonly retryAfterSec: number) {
    super("Too many requests – slow down");
    this.name = "RateLimitError";
  }
}
