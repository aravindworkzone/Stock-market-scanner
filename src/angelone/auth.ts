import { SmartAPI } from "smartapi-javascript";
import { generate } from "otplib";
import { config } from "../config";
import { AppError } from "../errors";
import { logger } from "../logger";

const TIME_SOURCES = [
  "https://margincalculator.angelone.in",
  "https://www.cloudflare.com",
  "https://www.google.com",
];

async function getServerEpochSeconds(): Promise<number> {
  const localEpoch = Math.floor(Date.now() / 1000);

  for (const url of TIME_SOURCES) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      const serverDate = res.headers.get("date");
      const serverMs = serverDate ? Date.parse(serverDate) : NaN;
      if (Number.isNaN(serverMs)) continue;

      const serverEpoch = Math.floor(serverMs / 1000);
      const drift = serverEpoch - localEpoch;
      if (Math.abs(drift) > 15) {
        logger.warn(`[angelone] Local clock is off by ${drift}s; using server time for TOTP. Consider syncing your system clock.`);
      }
      return serverEpoch;
    } catch {
      
    }
  }

  logger.warn("[angelone] Could not fetch server time; using local clock for TOTP.");
  return localEpoch;
}

export async function createAngelOneSession() {
  let response;

  const smartApi = new SmartAPI({
    api_key: config.ANGELONE_API_KEY,
  });

  try {
    const totp = await generate({
      secret: config.ANGELONE_TOTP_SECRET,
      epoch: await getServerEpochSeconds(),
    });

    response = await smartApi.generateSession(
      config.ANGELONE_CLIENT_CODE,
      config.ANGELONE_PIN,
      totp,
    );
  } catch (error: any) {
    throw new AppError("BROKER_API_ERROR", error.message || "Angel One login request failed.");
  }

  if (!response?.status || !response?.data?.jwtToken) {
    throw new AppError("BROKER_API_ERROR", "Angel One login failed or returned no session token.");
  }

  const profileResponse = await smartApi.getProfile();
  logger.info(`Profile API status: ${profileResponse.status}`);
  logger.info(`Profile data received: ${Boolean(profileResponse.data)}`);

  return smartApi;
}
