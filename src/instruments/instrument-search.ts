import { loadInstrumentMaster } from './instrument-load.js';
import { type InstrumentRecord } from '../types/instruments.js';
import { AppError } from '../errors.js';

interface queryParams {
    token?: string;
    symbol?: string;
    name?: string;
}

function normalizedQuery(value: string) {
    return value.replace(/\s+/g, '').toLowerCase().trim();
}

export default async function searchInstruments (query: queryParams, exch_seg: string): Promise<InstrumentRecord[]> {

    if (![query.token, query.symbol, query.name].some(v => v?.trim())) {
        throw new AppError("VALIDATION_ERROR", "Please provide a valid search query.");
    }

    const instruments = await loadInstrumentMaster();

    const n = normalizedQuery;
    const name = query.name?.trim() ? n(query.name) : undefined;
    const symbol = query.symbol?.trim() ? n(query.symbol) : undefined;
    const token = query.token?.trim() || undefined;
    const OptExchange = n(exch_seg);

    return instruments.filter((i) =>
        n(i.exch_seg) === OptExchange &&
        (!name || n(i.name).includes(name)) &&
        (!symbol || n(i.symbol).includes(symbol)) &&
        (!token || i.token === token)
    );
}