import { AppError } from '../errors.js';

const INSTRUMENT_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";

const downloadInstrumentMaster = async (): Promise<unknown> => {
    let result: Response;

    try {
        result = await fetch(INSTRUMENT_MASTER_URL);
    } catch (error) {
        throw new AppError(
            'NETWORK_ERROR',
            'Unable to download the instrument master.',
            error,
        );
    }

    if (!result.ok) {
        throw new AppError(
            'BROKER_API_ERROR',
            `Instrument master download failed with HTTP ${result.status}.`,
        );
    }

    try {
        return await result.json();
    } catch (error) {
        throw new AppError(
            'BROKER_API_ERROR',
            'The instrument master response contains invalid JSON.',
            error,
        );
    }
};

export default downloadInstrumentMaster;