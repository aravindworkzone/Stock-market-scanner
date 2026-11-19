import { config } from "../config/config.js";
import {
  DEFAULT_BACKOFF,
  TokenBucketRateLimiter,
  parseRateLimitOverrides,
  type BackoffSettings,
} from "./rate-limiter.js";

/** Process-wide limiter shared by call(), login/refresh and the candle loader. */
export const brokerRateLimiter = new TokenBucketRateLimiter({
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  operationSettings: parseRateLimitOverrides(config.SMARTAPI_RATE_LIMITS),
});

export const brokerBackoff: BackoffSettings = {
  ...DEFAULT_BACKOFF,
  maxRetries: config.SMARTAPI_BACKOFF_MAX_RETRIES,
  initialDelayMilliseconds: config.SMARTAPI_BACKOFF_INITIAL_MS,
};
