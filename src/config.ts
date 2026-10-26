import "dotenv/config";
import { z } from "zod";

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