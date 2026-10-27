import getAngelOneClient from "./session-manager.js";
import { toAppError, AppError } from "../errors.js";
import { logger } from "../logger.js";
import type { AngelOneCandle, AngelOneApiResponse } from "../types/angelone.js";

export default async function getHistoricalCandles(
  exchange: string,
  symboltoken: string,
  interval: string,
  fromdate: string,
  todate: string,
): Promise<AngelOneApiResponse<AngelOneCandle[]>> {
  try {
    if (!exchange || !symboltoken || !interval || !fromdate || !todate) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Please provide valid candle request details.",
      );
    }

    const smartApi = await getAngelOneClient();

    const historicalCandles = await smartApi.getCandleData({
      exchange,
      symboltoken,
      interval,
      fromdate,
      todate,
    });

    return historicalCandles;
  } catch (error: unknown) {
    const candleError = toAppError(error);
    logger.error(candleError.message, candleError.code);
    throw candleError;
  }
}