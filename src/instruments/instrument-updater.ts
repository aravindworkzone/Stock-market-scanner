import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

import downloadInstrumentMaster from './instrument-downloader.js';
import { logger } from '../logger.js';
import { AppError, toAppError } from '../errors.js';
import { InstrumentMasterSchema } from '../util/validator.js';
import { reloadInstrumentMaster } from './instrument-repository.js';

const DATA_DIRECTORY = path.resolve(process.cwd(), 'data', 'instruments');

const INSTRUMENT_MASTER_FILE = path.join(DATA_DIRECTORY, 'OpenAPIScripMaster.json');

const TEMP_INSTRUMENT_MASTER_FILE = `${INSTRUMENT_MASTER_FILE}.tmp`;

const updateInstrumentMaster = async (): Promise<void> => {
    try {
        const data: unknown = await downloadInstrumentMaster();

        const validationResult = InstrumentMasterSchema.safeParse(data);

        if (!validationResult.success) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Downloaded instrument master has an invalid structure.',
            );
        }

        const instruments = validationResult.data;

        await mkdir(DATA_DIRECTORY, { recursive: true });

        await writeFile(
            TEMP_INSTRUMENT_MASTER_FILE,
            JSON.stringify(instruments),
            'utf-8',
        );

        await rename(
            TEMP_INSTRUMENT_MASTER_FILE,
            INSTRUMENT_MASTER_FILE,
        );

        reloadInstrumentMaster();

        logger.info('Instrument master updated successfully.');
    } catch (error) {
        const appError = toAppError(error);

        logger.error(appError.message, appError.code);

        throw appError;
    }
};

export default updateInstrumentMaster;