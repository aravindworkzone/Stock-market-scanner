/**
 * Per-operation token bucket with a FIFO queue, plus exponential backoff settings.
 *
 * Official SmartAPI per-endpoint limits are UNKNOWN (audit/REPORT.md B0: the docs
 * were not machine-readable). Forum posts claim getCandleData allows 3/s, 180/min and
 * 5000/h, but those figures are UNVERIFIED, and the audit observed HTTP 403
 * "exceeding access rate" on getCandleData at about 1 request per minute. The defaults
 * below are therefore deliberately conservative; override them with SMARTAPI_RATE_LIMITS.
 */
import { z } from "zod";

export interface RateLimitSettings {
  /** Sustained rate (tokens added per second). */
  requestsPerSecond: number;
  /** Bucket size: how many requests may go back to back. */
  burst: number;
}

export interface BackoffSettings {
  maxRetries: number;
  initialDelayMilliseconds: number;
  multiplier: number;
  maxDelayMilliseconds: number;
}

/** Applied to any operation without its own entry. Conservative guess, not an official limit. */
export const DEFAULT_RATE_LIMIT: RateLimitSettings = { requestsPerSecond: 1, burst: 1 };

/** Conservative per-operation defaults (keys are call() operation names = SDK method names). */
export const DEFAULT_OPERATION_RATE_LIMITS: Readonly<Record<string, RateLimitSettings>> = {
  // UNVERIFIED forum figure 3/s; observed 403s at much lower rates, so stay at 1 per 2 s.
  getCandleData: { requestsPerSecond: 0.5, burst: 1 },
  // Logins and token refreshes are rare; never burst them.
  generateSession: { requestsPerSecond: 0.2, burst: 1 },
  generateToken: { requestsPerSecond: 0.2, burst: 1 },
};

export const DEFAULT_BACKOFF: BackoffSettings = {
  maxRetries: 3,
  initialDelayMilliseconds: 2_000,
  multiplier: 2,
  maxDelayMilliseconds: 30_000,
};

const rateLimitSettingsSchema = z.object({
  requestsPerSecond: z.number().positive().max(100),
  burst: z.number().int().min(1).max(100),
});

const rateLimitOverridesSchema = z.record(z.string().min(1), rateLimitSettingsSchema);

/** Parses SMARTAPI_RATE_LIMITS, e.g. `{"getCandleData":{"requestsPerSecond":0.25,"burst":1}}`. Throws on invalid input. */
export function parseRateLimitOverrides(overridesJson: string | undefined): Record<string, RateLimitSettings> {
  if (overridesJson === undefined || overridesJson.trim().length === 0) {
    return {};
  }
  return rateLimitOverridesSchema.parse(JSON.parse(overridesJson));
}

/** Delay before retry number `retryIndex` (0-based): initial × multiplier^retryIndex, capped. */
export function computeBackoffDelayMilliseconds(retryIndex: number, backoff: BackoffSettings): number {
  return Math.min(backoff.initialDelayMilliseconds * backoff.multiplier ** retryIndex, backoff.maxDelayMilliseconds);
}

export interface RateLimiterDependencies {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  defaultSettings?: RateLimitSettings;
  operationSettings?: Readonly<Record<string, RateLimitSettings>>;
}

interface BucketState {
  settings: RateLimitSettings;
  availableTokens: number;
  lastRefillMilliseconds: number;
  blockedUntilMilliseconds: number;
  queueTail: Promise<void>;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, BucketState>();

  constructor(private readonly dependencies: RateLimiterDependencies) {}

  settingsFor(operationName: string): RateLimitSettings {
    return (
      this.dependencies.operationSettings?.[operationName] ??
      DEFAULT_OPERATION_RATE_LIMITS[operationName] ??
      this.dependencies.defaultSettings ??
      DEFAULT_RATE_LIMIT
    );
  }

  /** Resolves when the caller may send one request for `operationName`. Callers are served in FIFO order. */
  acquire(operationName: string): Promise<void> {
    const bucket = this.bucketFor(operationName);
    const turn = bucket.queueTail.then(() => this.waitForToken(bucket));
    bucket.queueTail = turn.catch(() => undefined);
    return turn;
  }

  /** Blocks `operationName` for `delayMilliseconds` (used after a RATE_LIMIT_ERROR) and empties its bucket. */
  penalize(operationName: string, delayMilliseconds: number): void {
    const bucket = this.bucketFor(operationName);
    const blockedUntil = this.dependencies.now() + delayMilliseconds;
    bucket.blockedUntilMilliseconds = Math.max(bucket.blockedUntilMilliseconds, blockedUntil);
    bucket.availableTokens = 0;
    bucket.lastRefillMilliseconds = bucket.blockedUntilMilliseconds;
  }

  private bucketFor(operationName: string): BucketState {
    let bucket = this.buckets.get(operationName);
    if (bucket === undefined) {
      const settings = this.settingsFor(operationName);
      bucket = {
        settings,
        availableTokens: settings.burst,
        lastRefillMilliseconds: this.dependencies.now(),
        blockedUntilMilliseconds: 0,
        queueTail: Promise.resolve(),
      };
      this.buckets.set(operationName, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState, nowMilliseconds: number): void {
    const elapsedSeconds = Math.max(0, nowMilliseconds - bucket.lastRefillMilliseconds) / 1000;
    bucket.availableTokens = Math.min(
      bucket.settings.burst,
      bucket.availableTokens + elapsedSeconds * bucket.settings.requestsPerSecond,
    );
    bucket.lastRefillMilliseconds = Math.max(bucket.lastRefillMilliseconds, nowMilliseconds);
  }

  private async waitForToken(bucket: BucketState): Promise<void> {
    for (;;) {
      const nowMilliseconds = this.dependencies.now();
      if (nowMilliseconds < bucket.blockedUntilMilliseconds) {
        await this.dependencies.sleep(bucket.blockedUntilMilliseconds - nowMilliseconds);
        continue;
      }
      this.refill(bucket, nowMilliseconds);
      if (bucket.availableTokens >= 1) {
        bucket.availableTokens -= 1;
        return;
      }
      const missingTokens = 1 - bucket.availableTokens;
      await this.dependencies.sleep(Math.ceil((missingTokens / bucket.settings.requestsPerSecond) * 1000));
    }
  }
}
