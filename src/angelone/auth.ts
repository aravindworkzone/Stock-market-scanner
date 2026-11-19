// Must stay the first import: replaces the SDK's secret-leaking ./error.log logger.
import "./sdk-logger.js";
import { SmartAPI } from "smartapi-javascript";
import { generate } from "otplib";
import { config } from "../config/config.js";
import { AppError, toAppError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { brokerRateLimiter } from "./broker-rate-limiter.js";
import {
  brokerFailureToAppError,
  classifyBrokerResponse,
  reportUnrecognizedBrokerErrorCode,
} from "./broker-response.js";

const TIME_SOURCES = [
  "https://margincalculator.angelone.in",
  "https://www.cloudflare.com",
  "https://www.google.com",
];

async function getServerEpochSeconds(): Promise<number> {
  const localEpoch = Math.floor(Date.now() / 1000);

  for (const url of TIME_SOURCES) {
    try {
      const timeResponse = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      const serverDate = timeResponse.headers.get("date");
      const serverMilliseconds = serverDate ? Date.parse(serverDate) : NaN;
      if (Number.isNaN(serverMilliseconds)) continue;

      const serverEpoch = Math.floor(serverMilliseconds / 1000);
      const drift = serverEpoch - localEpoch;
      if (Math.abs(drift) > 15) {
        logger.warn(`[angelone] Local clock is off by ${drift}s; using server time for TOTP. Consider syncing your system clock.`);
      }
      return serverEpoch;
    } catch {
      // Try the next time source.
    }
  }

  logger.warn("[angelone] Could not fetch server time; using local clock for TOTP.");
  return localEpoch;
}

export interface SessionTokens {
  jwtToken: string;
  refreshToken?: string;
}

/** Extracts the tokens from a classified login / token-refresh response. Throws `[CODE]` AppErrors. */
export function readSessionTokens(operationName: string, brokerResponse: unknown): SessionTokens {
  const classification = classifyBrokerResponse<Record<string, unknown>>(brokerResponse);
  if (classification.outcome === "failure") {
    reportUnrecognizedBrokerErrorCode(operationName, classification, logger.warn);
    throw brokerFailureToAppError(operationName, classification);
  }

  const sessionData = classification.envelope.data;
  const jwtToken = sessionData?.jwtToken;
  if (typeof jwtToken !== "string" || jwtToken.length === 0) {
    throw new AppError("BROKER_API_ERROR", `[BROKER_API_ERROR] ${operationName}: Angel One returned no session token.`);
  }
  const refreshToken = typeof sessionData?.refreshToken === "string" ? sessionData.refreshToken : undefined;
  return { jwtToken, refreshToken };
}

export interface AngelOneSession {
  client: SmartAPI;
  tokens: SessionTokens;
}

export async function createAngelOneSession(): Promise<AngelOneSession> {
  const smartApi = new SmartAPI({
    api_key: config.ANGELONE_API_KEY,
  });

  let loginResponse: unknown;
  try {
    await brokerRateLimiter.acquire("generateSession");
    const totp = await generate({
      secret: config.ANGELONE_TOTP_SECRET,
      epoch: await getServerEpochSeconds(),
    });

    loginResponse = await smartApi.generateSession(
      config.ANGELONE_CLIENT_CODE,
      config.ANGELONE_PIN,
      totp,
    );
  } catch (error: unknown) {
    const loginError = toAppError(error);
    throw new AppError(loginError.code, `[${loginError.code}] generateSession: ${loginError.message}`, error);
  }

  const tokens = readSessionTokens("generateSession", loginResponse);

  const profileClassification = classifyBrokerResponse(await smartApi.getProfile());
  logger.info(`Profile check after login: ${profileClassification.outcome}`);

  return { client: smartApi, tokens };
}
