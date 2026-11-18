import getHistoricalCandles from "../angelone/historical-candles"
import { toAppError, AppError } from "../errors";
import searchInstruments from "../instruments/instrument-search";
import { logger } from "../logger";
import {saveDailyCandles} from "./candles.repository";
import indexStock from "../indices/index-stock.service";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function uploadCandleData(
  exchange: string,
  symboltoken: string,
  interval: string,
  fromdate: string,
  todate: string,
  symbol?: string,
) {
    try {
        if (!symbol) {
            const instrument = await searchInstruments({ token: symboltoken }, exchange);
            symbol = instrument[0]?.symbol;
        }
        if (!symbol) {
            throw new AppError("VALIDATION_ERROR", `No instrument found for token ${symboltoken} on exchange ${exchange}.`);
        }

        const historicalCandles = await getHistoricalCandles(exchange, symboltoken, interval, fromdate, todate);
        if(!historicalCandles.status || !historicalCandles.data?.length) {
            throw new AppError("BROKER_API_ERROR", "No candle data found for the specified parameters.");
        }
        const savedCount = await saveDailyCandles(exchange, symboltoken, symbol, historicalCandles.data);
        return savedCount;
    } catch (error) {
        const appError = toAppError(error);
        logger.error(appError.message, appError.code);
        throw appError;
    }
}

export async function uploadNifty500HistoricalData() {
    try {
        const Nifty500 = await indexStock("NIFTY 500");

        const today = new Date();
        const from = new Date(today);
        from.setFullYear(from.getFullYear() - 2);

        const formatDate = (date: Date, time: string) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${time}`;

        const fromdate = formatDate(from, "09:15");
        const todate = formatDate(today, "15:30");
        const interval = "ONE_DAY";
        const exchange = "NSE";

        let successCount = 0;
        let failedCount = 0;

        const failedStocks: string[] = [];

        for (const stock of Nifty500) {
            try {
                const savedCount = await uploadCandleData(
                    exchange,
                    stock.symboltoken,
                    interval,
                    fromdate,
                    todate,
                    stock.symbol
                );

                successCount++;

                logger.info(
                    `${stock.symbol}: ${savedCount} candle records saved.`
                );

            } catch (error) {
                failedCount++;
                failedStocks.push(stock.symbol);

                logger.error(
                    `Failed to upload ${stock.symbol}: ${error instanceof Error ? error.message : String(error)}`
                );
            }

            await delay(1000);
        }

        return {
            totalStocks: Nifty500.length,
            successCount,
            failedCount,
            failedStocks
        };

    } catch (error) {
        const appError = toAppError(error);
        logger.error(appError.message, appError.code);
        throw appError;
    }
}