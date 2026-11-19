    import { AppError, toAppError } from '../../core/errors.js';
    import fromToDate from '../../util/fromToDate.js';
    import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
    import { AngelOneCandle } from '../../types/angelone.js';
import { readValidatedHighLowClose } from './candle-validation.js';
    import { assertDailyInterval } from './indicator-window.js';

    export default async function ATR(
        exchange: string,
        symboltoken: string,
        interval: string,
        period: number = 14
    ) {
        try {
            if (!exchange || !symboltoken || !interval) {
                throw new AppError(
                    'VALIDATION_ERROR',
                    'Exchange, symbol token and interval are required.'
                );
            }

            assertDailyInterval(interval);

            if (!Number.isSafeInteger(period) || period <= 0) {
                throw new AppError(
                    'VALIDATION_ERROR',
                    'Period must be a positive safe integer.'
                );
            }

            const candleCount = period * 5 + 1;

            if (!Number.isSafeInteger(candleCount)) {
                throw new AppError(
                    'VALIDATION_ERROR',
                    'ATR historical period is too large.'
                );
            }

            const currentDate = new Date().toLocaleDateString('en-CA', {
                timeZone: 'Asia/Kolkata'
            });

            const ATR_date = fromToDate(
                currentDate,
                'backward',
                candleCount
            );

            const Candle = await getDailyCandles(
                exchange,
                symboltoken,
                ATR_date.fromdate,
                ATR_date.todate
            );

            if (!Candle || Candle.status !== true) {
                throw new AppError(
                    'DATABASE_ERROR',
                `Unable to fetch daily candles: ${Candle?.message}`
                );
            }

            if (!Array.isArray(Candle.data)) {
                throw new AppError(
                    'NO_DATA',
                    'Invalid historical candle response.'
                );
            }

            const data: AngelOneCandle[] = toAngelOneCandles(Candle.data);

            const result = getATR(data, period);

            return result;

        } catch (error) {
            throw toAppError(error);
        }
    }


    export function getATR(
        Candle: AngelOneCandle[],
        period: number = 14
    ) {

        if (!Number.isSafeInteger(period) || period <= 0) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Period must be a positive safe integer.'
            );
        }

        if (!Array.isArray(Candle) || Candle.length < period + 1) {
            throw new AppError(
                'NO_DATA',
                `At least ${period + 1} candles are required.`
            );
        }

        const candles = readValidatedHighLowClose(Candle);

        const trueRanges: number[] = [];

        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i - 1];

            const trueRange = Math.max(
                current.high - current.low,
                Math.abs(current.high - previous.close),
                Math.abs(current.low - previous.close)
            );

            trueRanges.push(trueRange);
        }

        if (trueRanges.length < period) {
            throw new AppError(
                'NO_DATA',
                `At least ${period + 1} candles are required.`
            );
        }

        let atr = trueRanges
            .slice(0, period)
            .reduce((sum, value) => sum + value, 0) / period;

        for (let i = period; i < trueRanges.length; i++) {
            atr = (
                (atr * (period - 1)) + trueRanges[i]
            ) / period;
        }

        return {
            indicator: 'ATR',
            period,
            source: 'high-low-close',
            value: Number(atr.toFixed(2)),
            timestamp: Candle[Candle.length - 1][0]
        };
    }
