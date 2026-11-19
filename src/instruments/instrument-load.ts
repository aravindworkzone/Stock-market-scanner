import { readFile } from 'node:fs/promises';
import { InstrumentMasterSchema } from '../util/validator.js';
import { type InstrumentRecord } from '../types/instruments.js';
import { AppError } from '../core/errors.js';
import { resolveInstrumentMasterFile } from '../config/paths.js';

// <DATA_DIR or project root/data>/instruments/OpenAPIScripMaster.json (same file the updater writes).
const INSTRUMENT_MASTER_FILE = resolveInstrumentMasterFile();
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

const reloadInstrumentMaster = (): void => {
    instrumentCache = null;
};

export { loadInstrumentMaster, reloadInstrumentMaster };