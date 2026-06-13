/**
 * Minimal in-memory fixed-window rate limiter for the optional HTTP edge.
 *
 * The hosted Glitch facade is the authoritative limiter; this is a cheap
 * additional guard for self-hosted HTTP proxies. Keyed per credential (or IP)
 * so one noisy caller cannot exhaust the process. Disabled when limit <= 0.
 */
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

const WINDOW_MS = 60_000;

export function createFixedWindowRateLimiter(limitPerMinute: number, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string): RateLimitResult {
      if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const current = now();
      const entry = hits.get(key);

      if (!entry || current >= entry.resetAt) {
        hits.set(key, { count: 1, resetAt: current + WINDOW_MS });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (entry.count < limitPerMinute) {
        entry.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - current) / 1000)) };
    }
  };
}
