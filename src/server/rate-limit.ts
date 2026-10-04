/**
 * In-memory sliding-window rate limiter (per process). Good enough for a single instance; behind a load
 * balancer use a shared store (e.g. Redis) – the interface stays the same.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0]!)) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

/** Is the key over its limit right now? Does not count as a hit (used to throttle on FAILED attempts only). */
export function isRateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  return (buckets.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
}
