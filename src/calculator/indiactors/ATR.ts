    import { AppError, toAppError } from '../../errors.js';
    import fromToDate from '../../util/fromToDate.js';
    import getHistoricalCandles from '../../angelone/historical-candles.js';
    import { AngelOneCandle } from '../../types/angelone.js';

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

            const Candle = await getHistoricalCandles(
                exchange,
                symboltoken,
                interval,
                ATR_date.fromdate,
                ATR_date.todate
            );

            if (!Candle || Candle.status !== true) {
                throw new AppError(
                    'BROKER_API_ERROR',
                    `Angel One failed: status=${Candle?.status}, code=${Candle?.errorcode}, msg=${Candle?.message}`
                );
            }

            if (!Array.isArray(Candle.data)) {
                throw new AppError(
                    'NO_DATA',
                    'Invalid historical candle response.'
                );
            }

            const data: AngelOneCandle[] = Candle.data;

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

        const candles = Candle.map((candle) => {
            if (!Array.isArray(candle) || candle.length < 5) {
                throw new AppError(
                    'VALIDATION_ERROR',
                    'Invalid candle structure.'
                );
            }

            const high = Number(candle[2]);
            const low = Number(candle[3]);
            const close = Number(candle[4]);

            if (
                !Number.isFinite(high) ||
                !Number.isFinite(low) ||
                !Number.isFinite(close) ||
                high <= 0 ||
                low <= 0 ||
                close <= 0 ||
                high < low ||
                close > high ||
                close < low
            ) {
                throw new AppError(
                    'VALIDATION_ERROR',
                    'Invalid candle OHLC values.'
                );
            }

            return {
                high,
                low,
                close
            };
        });

        for (let i = 1; i < Candle.length; i++) {
            const previousTime = new Date(Candle[i - 1][0]).getTime();
            const currentTime = new Date(Candle[i][0]).getTime();

            if (
                !Number.isFinite(previousTime) ||
                !Number.isFinite(currentTime) ||
                currentTime <= previousTime
            ) {
                throw new AppError(
                    'VALIDATION_ERROR',
                    'Candles must be in valid chronological ascending order.'
                );
            }
        }

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
