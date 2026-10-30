import { loadInstrumentMaster } from './instrument-load.js';
import { type InstrumentRecord } from '../types/instruments.js';
import { toAppError } from '../errors.js';
import { logger } from '../logger.js';

export default async function searchInstruments (query: string, exch_seg: string): Promise<InstrumentRecord[]> {
    let instruments: InstrumentRecord[];
    try {
        instruments = await loadInstrumentMaster();
    } catch (error) {
        const appError = toAppError(error);

        logger.error(appError.message, appError.code);

        throw appError;
    }

    const normalizedQuery = query.replace(/\s+/g, '').toLowerCase();
    const normalizedExchange = exch_seg.trim().toLowerCase();

    return instruments.filter((instrument) => {
        const normalizedName = instrument.name
            .replace(/\s+/g, '')
            .toLowerCase();

        const normalizedSymbol = instrument.symbol
            .replace(/\s+/g, '')
            .toLowerCase();

        return (
            instrument.exch_seg.toLowerCase() === normalizedExchange &&
            (
                normalizedName.includes(normalizedQuery) ||
                normalizedSymbol.includes(normalizedQuery)
            )
        );
    });
};