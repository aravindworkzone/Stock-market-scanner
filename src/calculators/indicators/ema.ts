import { AppError, toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';

export async function EMA(
    exchange: string,
    symboltoken: string,
    interval: string,
    period: number
) {
    try {
        if (!exchange || !symboltoken || !interval || period === undefined || period === null) {
            throw new AppError('VALIDATION_ERROR', 'Missing required parameters');
        }

        if (!Number.isSafeInteger(period) || period <= 0) {
            throw new AppError('VALIDATION_ERROR', 'Period must be a positive safe integer');
        }

        const EMA_period = period * 5;

        if (!Number.isSafeInteger(EMA_period)) {
            throw new AppError('VALIDATION_ERROR', 'EMA historical period is too large');
        }

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const EMA_date = fromToDate(currentDate, 'backward', EMA_period);

        const Candle = await getDailyCandles(
            exchange,
            symboltoken,
            EMA_date.fromdate,
            EMA_date.todate
        );

        if (!Array.isArray(Candle?.data)) {
            throw new AppError('NO_DATA', 'Invalid historical candle response');
        }

        const data: AngelOneCandle[] = toAngelOneCandles(Candle.data);

        const result = getEMA(data, period);

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getEMA(Candle: AngelOneCandle[], period: number) {

    if (!Number.isSafeInteger(period) || period <= 0) {
        throw new AppError('VALIDATION_ERROR', 'Period must be a positive integer');
    }

    if (!Array.isArray(Candle) || Candle.length < period) {
        throw new AppError(
            'NO_DATA',
            'Not enough candle data available for the given parameters.'
        );
    }

    const closes: number[] = Candle.map((c) => {
        if (!Array.isArray(c) || c.length < 5) {
            throw new AppError('VALIDATION_ERROR', 'Invalid candle structure');
        }

        const close = Number(c[4]);

        if (!Number.isFinite(close) || close <= 0) {
            throw new AppError('VALIDATION_ERROR', 'Invalid candle close price');
        }

        return close;
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
                'Candles must be in valid chronological ascending order'
            );
        }
    }

    let ema = closes
        .slice(0, period)
        .reduce((sum, close) => sum + close, 0) / period;

    const k = 2 / (period + 1);

    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }

    return {
        indicator: 'EMA',
        period,
        source: 'close',
        'latest ema': Math.round(ema * 100) / 100
    };
}