import { toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';

import { getSMA } from './sma.js';
import { getEMA } from './ema.js';
import { getRSI } from './rsi.js';
import { getMACD } from './macd.js';
import { getATR } from './atr.js';
import { getVolumeAverage } from './volume-average.js';
import { getWeek52HighLow } from './week-52-high-low.js';
import { getSupportResistance } from './support-resistance.js';
import {
    assertDailyInterval,
    candlesOnOrAfter,
    indicatorWarmupTradingDays,
    week52WindowStartDate,
} from './indicator-window.js';

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

        assertDailyInterval(interval);

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const { fromdate, todate } = fromToDate(
            currentDate,
            'backward',
            indicatorWarmupTradingDays(period)
        );

        const response = await getDailyCandles(
            exchange,
            symboltoken,
            fromdate,
            todate
        );

        if (!response.status || !Array.isArray(response.data)) {
            throw new Error(response.message || 'Unable to fetch historical candles');
        }

        const Candle: AngelOneCandle[] = toAngelOneCandles(response.data);

        if (Candle.length === 0) {
            throw new Error('No historical candles available');
        }

        // B1: the fetch window is >= 365 trading days (~17 months); 52-week high/low must
        // use only the last 364 calendar days, like get_52_week_high_low.
        const week52Candles: AngelOneCandle[] = candlesOnOrAfter(Candle, week52WindowStartDate(currentDate));

        return {
            symboltoken,
            exchange,
            interval,
            period,

            SMA: {
                10: getSMA(Candle, 10),
                20: getSMA(Candle, 20),
                50: getSMA(Candle, 50),
                200: getSMA(Candle, 200),
            },

            EMA: {
                10: getEMA(Candle, 10),
                20: getEMA(Candle, 20),
                50: getEMA(Candle, 50),
                200: getEMA(Candle, 200)
            },

            RSI: getRSI(Candle, period),

            MACD: getMACD(Candle, 12, 26, 9),

            ATR: getATR(Candle, period),

            VolumeAverage: getVolumeAverage(Candle, period),

            Week52HighLow: getWeek52HighLow(week52Candles),

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