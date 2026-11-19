// Must stay the first import: replaces the SDK's secret-leaking ./error.log logger.
import "./sdk-logger.js";
import type { SmartAPI } from "smartapi-javascript";
import { createAngelOneSession, readSessionTokens, type AngelOneSession, type SessionTokens } from "./auth.js";
import { config } from "../config/config.js";
import { toAppError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { brokerRateLimiter } from "./broker-rate-limiter.js";

const MILLISECONDS_PER_MINUTE = 60_000;
/** IST is UTC+05:30 with no daylight saving. */
const IST_OFFSET_MILLISECONDS = (5 * 60 + 30) * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;

/** Reads the `exp` claim (seconds) of a JWT and returns it in milliseconds, or undefined. Never verifies or logs the token. */
export function decodeJwtExpiryMilliseconds(jwtToken: string): number | undefined {
  const tokenParts = jwtToken.split(".");
  if (tokenParts.length < 2) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(tokenParts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Next 00:00 IST strictly after `nowMilliseconds` (observed JWT expiry; used when `exp` is missing). */
export function nextIstMidnightMilliseconds(nowMilliseconds: number): number {
  const istWallClock = nowMilliseconds + IST_OFFSET_MILLISECONDS;
  const nextIstMidnightWallClock = (Math.floor(istWallClock / MILLISECONDS_PER_DAY) + 1) * MILLISECONDS_PER_DAY;
  return nextIstMidnightWallClock - IST_OFFSET_MILLISECONDS;
}

/**
 * When to refresh: `margin` before expiry. If that moment has already passed (e.g. a
 * fresh login at 23:55 still expires at 00:00), wait until expiry instead of
 * refreshing on every call.
 */
export function computeRefreshAfterMilliseconds(
  expiresAtMilliseconds: number,
  nowMilliseconds: number,
  refreshMarginMilliseconds: number,
): number {
  const refreshAt = expiresAtMilliseconds - refreshMarginMilliseconds;
  return refreshAt > nowMilliseconds ? refreshAt : expiresAtMilliseconds;
}

interface ActiveSession {
  client: SmartAPI;
  tokens: SessionTokens;
  expiresAtMilliseconds: number;
  refreshAfterMilliseconds: number;
}

export interface SessionManagerDependencies {
  createSession: () => Promise<AngelOneSession>;
  /** Waits for a rate-limit token before generateToken. */
  acquireRateLimit?: (operationName: string) => Promise<void>;
  now: () => number;
  refreshMarginMilliseconds: number;
  writeInfo: (message: string) => void;
  writeWarning: (message: string) => void;
}

export class SessionManager {
  private activeSession: ActiveSession | null = null;
  private pendingSession: Promise<ActiveSession> | null = null;

  constructor(private readonly dependencies: SessionManagerDependencies) {}

  /** Returns a logged-in client, logging in or refreshing first when needed. Concurrent callers share one login. */
  async getClient(): Promise<SmartAPI> {
    if (this.pendingSession !== null) {
      return (await this.pendingSession).client;
    }
    const currentSession = this.activeSession;
    const nowMilliseconds = this.dependencies.now();
    if (currentSession === null || nowMilliseconds >= currentSession.expiresAtMilliseconds) {
      return (await this.runExclusively(() => this.login())).client;
    }
    if (nowMilliseconds >= currentSession.refreshAfterMilliseconds) {
      return (await this.runExclusively(() => this.refreshOrLogin(currentSession))).client;
    }
    return currentSession.client;
  }

  /** Forces a fresh login (shared with any login already in flight). */
  async forceLogin(): Promise<SmartAPI> {
    return (await this.runExclusively(() => this.login())).client;
  }

  /**
   * Called after a broker AUTHENTICATION_ERROR. Re-logs in once; if another caller
   * already replaced the failed client, the current session is reused.
   */
  async recoverFromAuthenticationFailure(failedClient: SmartAPI): Promise<SmartAPI> {
    if (this.pendingSession !== null) {
      return (await this.pendingSession).client;
    }
    if (this.activeSession !== null && this.activeSession.client !== failedClient) {
      return this.activeSession.client;
    }
    this.dependencies.writeWarning("[session] Angel One reported an invalid session; logging in again.");
    return (await this.runExclusively(() => this.login())).client;
  }

  clear(): void {
    this.activeSession = null;
  }

  private runExclusively(operation: () => Promise<ActiveSession>): Promise<ActiveSession> {
    if (this.pendingSession === null) {
      this.pendingSession = operation()
        .then((nextSession) => {
          this.activeSession = nextSession;
          return nextSession;
        })
        .finally(() => {
          this.pendingSession = null;
        });
    }
    return this.pendingSession;
  }

  private buildActiveSession(client: SmartAPI, tokens: SessionTokens): ActiveSession {
    const nowMilliseconds = this.dependencies.now();
    const expiresAtMilliseconds =
      decodeJwtExpiryMilliseconds(tokens.jwtToken) ?? nextIstMidnightMilliseconds(nowMilliseconds);
    const nextSession: ActiveSession = {
      client,
      tokens,
      expiresAtMilliseconds,
      refreshAfterMilliseconds: computeRefreshAfterMilliseconds(
        expiresAtMilliseconds,
        nowMilliseconds,
        this.dependencies.refreshMarginMilliseconds,
      ),
    };
    // Secondary signal only (fires solely on HTTP 200 + errorCode "AG8001"; responses
    // observed so far use lowercase "errorcode"). Primary detection is classifyBrokerResponse.
    client.setSessionExpiryHook(() => {
      if (this.activeSession === nextSession) {
        nextSession.refreshAfterMilliseconds = 0;
      }
    });
    return nextSession;
  }

  private async login(): Promise<ActiveSession> {
    const createdSession = await this.dependencies.createSession();
    const nextSession = this.buildActiveSession(createdSession.client, createdSession.tokens);
    this.dependencies.writeInfo(
      `[session] Logged in; token expires at ${new Date(nextSession.expiresAtMilliseconds).toISOString()}.`,
    );
    return nextSession;
  }

  private async refreshOrLogin(currentSession: ActiveSession): Promise<ActiveSession> {
    const refreshToken = currentSession.tokens.refreshToken;
    if (refreshToken !== undefined) {
      try {
        await this.dependencies.acquireRateLimit?.("generateToken");
        const refreshResponse = await currentSession.client.generateToken(refreshToken);
        const refreshedTokens = readSessionTokens("generateToken", refreshResponse);
        currentSession.client.setAccessToken(refreshedTokens.jwtToken);
        if (refreshedTokens.refreshToken !== undefined) {
          currentSession.client.setPublicToken(refreshedTokens.refreshToken);
        }
        const refreshedSession = this.buildActiveSession(currentSession.client, {
          jwtToken: refreshedTokens.jwtToken,
          refreshToken: refreshedTokens.refreshToken ?? refreshToken,
        });
        this.dependencies.writeInfo(
          `[session] Token refreshed; expires at ${new Date(refreshedSession.expiresAtMilliseconds).toISOString()}.`,
        );
        return refreshedSession;
      } catch (error: unknown) {
        this.dependencies.writeWarning(`[session] Token refresh failed (${toAppError(error).code}); logging in again.`);
      }
    }
    return this.login();
  }
}

export const sessionManager = new SessionManager({
  createSession: createAngelOneSession,
  acquireRateLimit: (operationName) => brokerRateLimiter.acquire(operationName),
  now: () => Date.now(),
  refreshMarginMilliseconds: config.SMARTAPI_SESSION_REFRESH_MARGIN_MINUTES * MILLISECONDS_PER_MINUTE,
  writeInfo: logger.info,
  writeWarning: logger.warn,
});

export function getAngelOneClient(): Promise<SmartAPI> {
  return sessionManager.getClient();
}

export function forcelogin(): Promise<SmartAPI> {
  return sessionManager.forceLogin();
}

export function clearAngelOneClient(): void {
  sessionManager.clear();
}
