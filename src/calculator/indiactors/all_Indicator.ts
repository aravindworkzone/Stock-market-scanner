import { toAppError } from '../../errors.js';
import fromToDate from '../../util/fromToDate.js';
import getHistoricalCandles from '../../angelone/historical-candles.js';
import { AngelOneCandle } from '../../types/angelone.js';

import { getSMA } from './SMA.js';
import { getEMA } from './EMA.js';
import { getRSI } from './RSI.js';
import { getMACD } from './MACD.js';
import { getATR } from './ATR.js';
import { getVolumeAverage } from './VolumeAverage.js';
import { getWeek52HighLow } from './Week52HighLow.js';
import { getSupportResistance } from './SupportResistance.js';

export default async function AllIndicators(
    exchange: string,
    symboltoken: string,
    interval: string,
    period: number
) {
    try {
        if (!exchange || !symboltoken || !interval || !Number.isSafeInteger(period) || period <= 0) {
            throw new Error('Exchange, symboltoken, interval and valid period are required');
        }

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const { fromdate, todate } = fromToDate(
            currentDate,
            'backward',
            Math.max(period * 5, 365)
        );

        // Fetch selected interval candles
        const response = await getHistoricalCandles(
            exchange,
            symboltoken,
            interval,
            fromdate,
            todate
        );

        if (!response.status || !Array.isArray(response.data)) {
            throw new Error(response.message || 'Unable to fetch historical candles');
        }

        const Candle: AngelOneCandle[] = response.data;

        if (Candle.length === 0) {
            throw new Error('No historical candles available');
        }

        // Fetch daily candles for static 52-week calculation
        let dailyCandle: AngelOneCandle[] = Candle;

        if (interval !== 'ONE_DAY') {
            const dailyDates = fromToDate(
                currentDate,
                'backward',
                365
            );

            const dailyResponse = await getHistoricalCandles(
                exchange,
                symboltoken,
                'ONE_DAY',
                dailyDates.fromdate,
                dailyDates.todate
            );

            if (!dailyResponse.status || !Array.isArray(dailyResponse.data)) {
                throw new Error(dailyResponse.message || 'Unable to fetch daily candles');
            }

            dailyCandle = dailyResponse.data;
        }

        return {
            symboltoken,
            exchange,
            interval,
            period,

            SMA: {
                10: getSMA(Candle, 10),
                20: getSMA(Candle, 20),
                50: getSMA(Candle, 50)
            },

            EMA: {
                10: getEMA(Candle, 10),
                20: getEMA(Candle, 20),
                50: getEMA(Candle, 50)
            },

            RSI: getRSI(Candle, period),

            MACD: getMACD(Candle, 12, 26, 9),

            ATR: getATR(Candle, period),

            VolumeAverage: getVolumeAverage(Candle, period),

            Week52HighLow: getWeek52HighLow(dailyCandle),

            SupportResistance: getSupportResistance(
                Candle,
                5,
                5,
                1
            )
        };

    } catch (error) {
        throw toAppError(error);
    }
}