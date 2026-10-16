/** Error thrown for every failed `/api/**` call; mirrors the `{ error: { code, message, issues } }` body. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues: unknown[] = [],
    /** Seconds from a `Retry-After` header (429), when present. */
    public retryAfterSec?: number,
    public userCount?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
