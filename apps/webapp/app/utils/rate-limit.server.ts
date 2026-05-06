import { ShelfError } from "./error";

/**
 * Per-user rate limit for mobile API handlers. Used as a second tier on top
 * of `mobileIpRateLimit` (server-level IP gate) — handlers call this *after*
 * `requireMobileAuth` so we can key on a verified user id.
 *
 * Backed by an in-process Map. Per-machine counters are acceptable here for
 * the same reason the IP gate is in-memory: this is a guardrail, not a
 * billing meter.
 */

type Bucket = "read" | "bulk";

type BucketConfig = {
  windowMs: number;
  limit: number;
};

// why: bulk operations write across many rows; cap them tighter than reads.
// The hourly cap on "bulk" is a burst-and-cooldown — short bursts are fine,
// sustained hammering is not.
const BUCKET_CONFIG: Record<string, BucketConfig> = {
  "read:1m": { windowMs: 60_000, limit: 120 },
  "bulk:1m": { windowMs: 60_000, limit: 10 },
  "bulk:1h": { windowMs: 60 * 60_000, limit: 200 },
};

const buckets: Record<string, BucketConfig[]> = {
  read: [BUCKET_CONFIG["read:1m"]],
  bulk: [BUCKET_CONFIG["bulk:1m"], BUCKET_CONFIG["bulk:1h"]],
};

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();

function check(
  key: string,
  config: BucketConfig,
  now: number
): { allowed: boolean; retryAfterSec: number } {
  const existing = counters.get(key);
  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (existing.count >= config.limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

// why: declared async (Promise<void> return type) so callers can `await` it
// and so swapping the in-memory store for an async one (e.g. Redis) later is
// a non-breaking change. The current implementation is sync — that's fine.
// eslint-disable-next-line @typescript-eslint/require-await
export async function enforceUserRateLimit(
  userId: string,
  bucket: Bucket
): Promise<void> {
  const now = Date.now();
  const configs = buckets[bucket];

  for (const config of configs) {
    const key = `mobile:user:${userId}:${bucket}:${config.windowMs}`;
    const result = check(key, config, now);
    if (!result.allowed) {
      throw new ShelfError({
        cause: null,
        message: "Too many requests. Please try again later.",
        additionalData: { userId, bucket, retryAfterSec: result.retryAfterSec },
        label: "Auth",
        status: 429,
        shouldBeCaptured: false,
      });
    }
  }
}

/**
 * Test-only — clears counters between tests. Not intended for production use.
 */
export function __resetUserRateLimitForTests(): void {
  counters.clear();
}
