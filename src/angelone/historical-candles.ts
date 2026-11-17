import { getAngelOneClient, handleSession } from "./session-manager.js";
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

    if(new Date(fromdate) > new Date(todate)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "fromdate cannot be later than todate.",
      );
    }

    const currentDate = new Date();

    if(new Date(todate) > currentDate) {
      throw new AppError(
        "VALIDATION_ERROR",
        "todate cannot be later than the current date.",
      );
    }

    return handleSession(async () => {
      const smartApi = await getAngelOneClient();

      const historicalCandles = await smartApi.getCandleData({
        exchange,
        symboltoken,
        interval,
        fromdate,
        todate,
      });

      if(historicalCandles.status === 403) {
        throw new AppError(
          "RATE_LIMIT_ERROR",
          'Angel One API rate limit exceeded. Please try again later.'
        );
      }

      return historicalCandles;
    });

  } catch (error: unknown) {
    const candleError = toAppError(error);
    logger.error(candleError.message, candleError.code);
    throw candleError;
  }
}