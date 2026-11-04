import {AngelOneCandle} from '../../types/angelone.js';
import { AppError, toAppError } from '../../errors.js';
import getHistoricalCandles from '../../angelone/historical-candles.js';

export default async function SMA(exchange: string, symboltoken: string, interval: string, fromdate: string, todate: string, period?: number) {
    try {
        const Candle = await getHistoricalCandles(exchange, symboltoken, interval, fromdate, todate);

        if (Candle.data === null || Candle.data === undefined) {
            throw new AppError('NO_DATA', 'No candle data available for the given parameters.');
        }

        const data: AngelOneCandle[] = Candle.data;

        const periodValue = period || data.length;
        let sum = 0;
        const SMAValue = data.map((c, i) => {
            sum += c[4];
            if (i >= periodValue) sum -= data[i - periodValue][4];
            return { date: c[0], sma: i < periodValue - 1 ? null : Math.round(sum / periodValue * 100) / 100 };
        });
        const latestSMA = SMAValue[SMAValue.length - 1].sma;

        const result = {
            "indicator": "SMA",
            "period": periodValue,
            "source": "close",
            "daily sma": SMAValue,
            "latest sma": latestSMA,
            "timestamp": data[data.length - 1][0]
        }

        return result;
    } catch (error) {
        const candleError = toAppError(error);
        throw candleError;
    }
}