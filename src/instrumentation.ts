/** Next.js instrumentation: unexpected errors of pages, server actions and route handlers go to error tracking. */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routeType: string; routePath?: string }) {
  if (process.env.NEXT_RUNTIME === "edge") return;
  // expected "errors" (403 / 404 pages, redirects) are control flow, not incidents
  const digest = (err as { digest?: string } | null)?.digest ?? "";
  if (digest.startsWith("NEXT_") || (err as { status?: number } | null)?.status) return;
  const { captureException } = await import("@/server/error-tracking");
  captureException(err, { route: context.routePath ?? request.path, method: request.method, kind: context.routeType });
}
