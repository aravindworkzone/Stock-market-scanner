import { CONSTITUENT_CONFIG } from './index.config.js';
import fetchIndexConstituents from './constituent.service.js';
import { loadInstrumentMaster } from '../instruments/instrument-load.js';
import { matchIndexConstituents } from './instrument-matcher.service.js';

const config = CONSTITUENT_CONFIG.NSE;

type IndexStockName = keyof typeof config.indexFiles;
type IndexFileName = (typeof config.indexFiles)[IndexStockName];

export default async function indexStock(indexName: IndexStockName) {
    const fileName: IndexFileName = config.indexFiles[indexName];

    const csvUrl = `${config.baseUrl}${config.endpoints.constituents}/${fileName}`;

    const constituents = await fetchIndexConstituents(csvUrl);
    const instruments = await loadInstrumentMaster();

    const result = matchIndexConstituents(constituents, instruments);

    return result.matched;
}