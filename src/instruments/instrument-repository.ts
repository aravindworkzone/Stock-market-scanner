import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { InstrumentMasterSchema, type InstrumentRecord } from '../util/validator.js';
import { AppError, toAppError } from '../errors.js';
import { logger } from '../logger.js';

const INSTRUMENT_MASTER_FILE = path.resolve(
    process.cwd(),
    'data',
    'instruments',
    'OpenAPIScripMaster.json',
);

let instrumentCache: InstrumentRecord[] | null = null;

const loadInstrumentMaster = async (): Promise<InstrumentRecord[]> => {
    if (instrumentCache !== null) {
        return instrumentCache;
    }

    const fileContent = await readFile(
        INSTRUMENT_MASTER_FILE,
        'utf-8',
    );

    const data: unknown = JSON.parse(fileContent);

    const result = InstrumentMasterSchema.safeParse(data);

    if (!result.success) {
        throw new AppError('VALIDATION_ERROR','Local instrument master has an invalid structure.');
    }

    instrumentCache = result.data;

    return instrumentCache;
};

const searchInstruments = async (query: string, exch_seg: string, limit: number = 10): Promise<InstrumentRecord[]> => {
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
    }).slice(0, limit);
};

const reloadInstrumentMaster = (): void => {
    instrumentCache = null;
};

export { loadInstrumentMaster, searchInstruments, reloadInstrumentMaster };