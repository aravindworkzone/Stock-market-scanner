import type { SmartAPI } from "smartapi-javascript";

/** Builds an unsigned JWT-shaped string whose payload carries `exp` (seconds). Test-only, not a real token. */
export function buildFakeJwt(expirySeconds: number | undefined, marker = "fake"): string {
  const encodePart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = expirySeconds === undefined ? { sub: marker } : { sub: marker, exp: expirySeconds };
  return `${encodePart({ alg: "none" })}.${encodePart(payload)}.${encodePart(marker)}`;
}

/** Minimal stand-in for the SmartAPI client: records calls, returns scripted responses. */
export class FakeSmartApiClient {
  accessToken: string | undefined;
  refreshToken: string | undefined;
  sessionExpiryHook: (() => void) | undefined;
  generateTokenResponses: unknown[] = [];
  generateTokenCalls: string[] = [];

  constructor(readonly label: string) {}

  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  setPublicToken(refreshToken: string): void {
    this.refreshToken = refreshToken;
  }

  setSessionExpiryHook(callback: () => void): void {
    this.sessionExpiryHook = callback;
  }

  async generateToken(refreshToken: string): Promise<unknown> {
    this.generateTokenCalls.push(refreshToken);
    return this.generateTokenResponses.shift() ?? {};
  }

  asSmartApi(): SmartAPI {
    return this as unknown as SmartAPI;
  }
}
