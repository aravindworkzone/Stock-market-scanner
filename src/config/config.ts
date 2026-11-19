import dotenv from "dotenv";
import { z } from "zod";
import { ENV_FILE_PATH } from "./paths.js";

// Project-root .env (not the cwd). Existing environment variables always win.
dotenv.config({ path: ENV_FILE_PATH, quiet: true });

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),

  MCP_AUTH_TOKEN: z.string().min(32, "MCP_AUTH_TOKEN must be at least 32 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  ANGELONE_API_KEY: z.string().trim().min(1, "ANGELONE_API_KEY is required"),
  ANGELONE_CLIENT_CODE: z.string().trim().min(1, "ANGELONE_CLIENT_CODE is required"),
  ANGELONE_PIN: z.string().min(1, "ANGELONE_PIN is required"),
  ANGELONE_TOTP_SECRET: z.string().trim().min(1, "ANGELONE_TOTP_SECRET is required"),

  DATABASE_URL_UNPOOLED: z.string().url("DATABASE_URL_UNPOOLED must be a valid URL"),
  NEON_BRANCH: z.string().trim().min(1, "NEON_BRANCH is required"),
  NEON_BRANCH_ID: z.string().trim().min(1, "NEON_BRANCH_ID is required"),
  NEON_FUNCTION_HOST_SUFFIX: z.string().trim().min(1, "NEON_FUNCTION_HOST_SUFFIX is required"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),

  // Directory for the redacted SmartAPI SDK error log (absolute, or relative to the
  // project root). Read directly by src/angelone/sdk-logger.ts, which must not import
  // this module (it exits on invalid env); declared here for documentation.
  SMARTAPI_LOG_DIR: z.string().trim().min(1).optional(),

  // Refresh the Angel One JWT this many minutes before its `exp` (00:00 IST).
  SMARTAPI_SESSION_REFRESH_MARGIN_MINUTES: z.coerce.number().int().min(1).max(720).default(15),

  // Per-operation rate-limit overrides as JSON, e.g.
  // {"getCandleData":{"requestsPerSecond":0.25,"burst":1}}. Official limits are UNKNOWN;
  // defaults live in src/angelone/rate-limiter.ts.
  SMARTAPI_RATE_LIMITS: z.string().trim().optional(),
  // Exponential backoff after a RATE_LIMIT_ERROR.
  SMARTAPI_BACKOFF_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  SMARTAPI_BACKOFF_INITIAL_MS: z.coerce.number().int().min(100).max(120_000).default(2_000),

  // Data directory (absolute or relative to the project root). Read by src/config/paths.ts.
  DATA_DIR: z.string().trim().min(1).optional(),

  // Incremental daily-candle updater (src/candles/daily-candle-updater.ts).
  // Today's candle is stored only after 15:30 IST + this buffer.
  CANDLE_UPDATE_MARKET_CLOSE_BUFFER_MINUTES: z.coerce.number().int().min(0).max(480).default(30),
  // Calendar days fetched for a symbol that has no stored candles yet.
  CANDLE_UPDATE_BOOTSTRAP_DAYS: z.coerce.number().int().min(1).max(3650).default(730),
  // Calendar days per getCandleData request. Angel One's per-interval maximum is UNKNOWN
  // (forum reports, UNVERIFIED: 2000 days for ONE_DAY and a 500-record cap), so stay well below.
  CANDLE_UPDATE_MAX_DAYS_PER_REQUEST: z.coerce.number().int().min(1).max(2000).default(365),
  // Stop a run after this many consecutive rate-limited symbols (each already retried with backoff).
  CANDLE_UPDATE_MAX_CONSECUTIVE_RATE_LIMITS: z.coerce.number().int().min(1).max(100).default(3),

  // Hours a fetched NIFTY constituent list is reused before re-fetching. On fetch failure the
  // last good copy (memory or data/constituents/) is used regardless of age and flagged stale.
  CONSTITUENT_CACHE_TTL_HOURS: z.coerce.number().min(0).max(168).default(12),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error("[config] Invalid application configuration.");
  for (const issue of result.error.issues) {
    console.error(`[config] ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;