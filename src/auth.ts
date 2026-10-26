import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";

const expected = Buffer.from(config.MCP_AUTH_TOKEN);

export function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const given = Buffer.from(token);

  return given.length === expected.length && timingSafeEqual(given, expected);
}

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string): number {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + config.RATE_LIMIT_WINDOW_MS });
    return 0;
  }

  entry.count++;
  return entry.count > config.RATE_LIMIT_MAX
    ? Math.ceil((entry.resetAt - now) / 1000)
    : 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) hits.delete(key);
  }
}, 60_000).unref();
