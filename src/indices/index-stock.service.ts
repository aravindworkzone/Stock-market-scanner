import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONSTITUENT_CONFIG } from './index.config.js';
import fetchIndexConstituents from './constituent.service.js';
import { loadInstrumentMaster } from '../instruments/instrument-load.js';
import {
    matchIndexConstituents,
    type MatchedConstituent,
    type UnmatchedConstituent,
} from './instrument-matcher.service.js';
import { ConstituentCache, type ConstituentLoadResult } from './constituent-cache.js';
import { resolveConstituentCacheDirectory } from '../config/paths.js';
import { config as appConfig } from '../config/config.js';
import { logger } from '../core/logger.js';
import type { InstrumentRecord } from '../types/instruments.js';

const config = CONSTITUENT_CONFIG.NSE;

type IndexStockName = keyof typeof config.indexFiles;
export type IndexName = IndexStockName;

export interface ConstituentSourceInfo {
    source: ConstituentLoadResult['source'];
    fetchedAt: string;
    stale: boolean;
    staleReason?: string;
}

export interface IndexStocksResult {
    matched: MatchedConstituent[];
    /** Constituents with no `${symbol}-${series}` instrument in the local master (B10: reported, not dropped silently). */
    unmatched: UnmatchedConstituent[];
    constituentsSource: ConstituentSourceInfo;
}

async function readTextFileIfPresent(filePath: string): Promise<string | undefined> {
    try {
        return await readFile(filePath, 'utf-8');
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

async function writeTextFileAtomically(filePath: string, fileContent: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryFilePath = `${filePath}.tmp`;
    await writeFile(temporaryFilePath, fileContent, 'utf-8');
    await rename(temporaryFilePath, filePath);
}

export const constituentCache = new ConstituentCache({
    fetchConstituents: fetchIndexConstituents,
    readCacheFile: readTextFileIfPresent,
    writeCacheFile: writeTextFileAtomically,
    cacheDirectory: resolveConstituentCacheDirectory(),
    freshForMilliseconds: appConfig.CONSTITUENT_CACHE_TTL_HOURS * 60 * 60 * 1000,
    now: () => Date.now(),
    writeWarning: logger.warn,
});

export interface IndexStocksDependencies {
    loadConstituents: (indexName: IndexName, csvUrl: string) => Promise<ConstituentLoadResult>;
    loadInstruments: () => Promise<InstrumentRecord[]>;
    writeWarning: (message: string) => void;
}

const defaultIndexStocksDependencies: IndexStocksDependencies = {
    loadConstituents: (indexName, csvUrl) => constituentCache.load(indexName, csvUrl),
    loadInstruments: loadInstrumentMaster,
    writeWarning: logger.warn,
};

export function constituentCsvUrl(indexName: IndexName): string {
    return `${config.baseUrl}${config.endpoints.constituents}/${config.indexFiles[indexName]}`;
}

export async function loadIndexStocks(
    indexName: IndexName,
    dependencies: IndexStocksDependencies = defaultIndexStocksDependencies,
): Promise<IndexStocksResult> {
    const constituentLoad = await dependencies.loadConstituents(indexName, constituentCsvUrl(indexName));
    const instruments = await dependencies.loadInstruments();
    const matchResult = matchIndexConstituents(constituentLoad.constituents, instruments);

    // Warn when the list was (re)loaded, not on every in-memory cache hit.
    if (matchResult.unmatched.length > 0 && constituentLoad.source !== 'memory-cache') {
        dependencies.writeWarning(
            `[constituents] ${indexName}: ${matchResult.unmatched.length} constituents have no instrument match: ` +
                matchResult.unmatched.map((stock) => `${stock.symbol}-${stock.series}`).join(', '),
        );
    }

    return {
        matched: matchResult.matched,
        unmatched: matchResult.unmatched,
        constituentsSource: {
            source: constituentLoad.source,
            fetchedAt: constituentLoad.fetchedAt,
            stale: constituentLoad.stale,
            ...(constituentLoad.staleReason !== undefined ? { staleReason: constituentLoad.staleReason } : {}),
        },
    };
}

/** Matched constituents only (unchanged contract for existing callers). */
export default async function indexStock(indexName: IndexStockName): Promise<MatchedConstituent[]> {
    return (await loadIndexStocks(indexName)).matched;
}
