/** Invalid input that is not a zod schema failure (e.g. a CSV without the required columns). → HTTP 400 */
export class BadRequestError extends Error {
  readonly code = "BAD_REQUEST";
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}
