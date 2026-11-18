import { AppError, toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';

export default async function VolumeAverage(
    exchange: string,
    symboltoken: string,
    interval: string,
    period: number = 20
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

        const candleCount = period * 5;

        if (!Number.isSafeInteger(candleCount)) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Volume historical period is too large.'
            );
        }

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const volumeDate = fromToDate(
            currentDate,
            'backward',
            candleCount
        );

        const Candle = await getDailyCandles(
            exchange,
            symboltoken,
            volumeDate.fromdate,
            volumeDate.todate
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

        const result = getVolumeAverage(data, period);

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getVolumeAverage(
    Candle: AngelOneCandle[],
    period: number = 20
) {

    if (!Number.isSafeInteger(period) || period <= 0) {
        throw new AppError(
            'VALIDATION_ERROR',
            'Period must be a positive safe integer.'
        );
    }

    if (!Array.isArray(Candle) || Candle.length < period) {
        throw new AppError(
            'NO_DATA',
            `At least ${period} candles are required.`
        );
    }

    // Validate candle structure and volume
    const volumes = Candle.map((candle) => {
        if (!Array.isArray(candle) || candle.length < 6) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Invalid candle structure.'
            );
        }

        const volume = Number(candle[5]);

        if (!Number.isSafeInteger(volume) || volume < 0) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Invalid candle volume.'
            );
        }

        return volume;
    });

    // Validate chronological order
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

    // Latest volume
    const latestVolume = volumes[volumes.length - 1];

    // Average volume of latest period candles
    const latestVolumes = volumes.slice(-period);

    const averageVolume =
        latestVolumes.reduce((sum, volume) => sum + volume, 0) / period;

    const relativeVolume =
        averageVolume === 0 ? null : latestVolume / averageVolume;

    return {
        indicator: 'VOLUME_AVERAGE',
        period,
        source: 'volume',
        'latest volume': latestVolume,
        'average volume': Math.round(averageVolume),
        'relative volume': relativeVolume === null
            ? null
            : Number(relativeVolume.toFixed(2)),
        timestamp: Candle[Candle.length - 1][0]
    };
}
