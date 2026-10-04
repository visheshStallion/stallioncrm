/** Typed access errors. API maps them to HTTP status codes; UI shows a toast or the 403/404 page. */
export class AccessError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND",
    readonly status: 401 | 403 | 404,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends AccessError {
  constructor(message = "Not signed in") {
    super(message, "UNAUTHENTICATED", 401);
  }
}

export class ForbiddenError extends AccessError {
  constructor(message = "You do not have permission to do that") {
    super(message, "FORBIDDEN", 403);
  }
}

/** Used for records outside the user's scope so their existence is never revealed. */
export class NotFoundError extends AccessError {
  constructor(message = "Not found") {
    super(message, "NOT_FOUND", 404);
  }
}

export function isAccessError(e: unknown): e is AccessError {
  return e instanceof AccessError;
}
