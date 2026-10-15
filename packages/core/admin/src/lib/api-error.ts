/** Error thrown for every failed `/api/**` call; mirrors the `{ error: { code, message, issues } }` body. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues: unknown[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
