import type { SmartApiEnvelope } from "smartapi-javascript";
import { call } from "./getAngelone.js";
import { toAppError, AppError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import type { AngelOneCandle } from "../types/angelone.js";

export default async function getHistoricalCandles(
  exchange: string,
  symboltoken: string,
  interval: string,
  fromdate: string,
  todate: string,
): Promise<SmartApiEnvelope<AngelOneCandle[]>> {
  try {
    if (!exchange || !symboltoken || !interval || !fromdate || !todate) {
      throw new AppError(
        "VALIDATION_ERROR",
        "[VALIDATION_ERROR] Please provide valid candle request details.",
      );
    }

    return await call<AngelOneCandle[]>("getCandleData", (client) =>
      client.getCandleData({ exchange, symboltoken, interval, fromdate, todate }),
    );
  } catch (error: unknown) {
    const candleError = toAppError(error);
    logger.error(candleError.message, candleError.code);
    throw candleError;
  }
}
