/**
 * Cache for NSE index constituent lists (niftyindices.com CSV).
 *
 * - Fresh copy in memory for `freshForMilliseconds`; concurrent loads share one fetch.
 * - Every successful fetch is also written to disk (data/constituents/<index>.json).
 * - If a fetch fails (or returns an empty list), the last good copy is used instead,
 *   from memory or disk, and the result is flagged `stale: true` with the reason.
 *   Only when no copy exists at all does the load fail.
 */
import path from "node:path";
import { AppError, toAppError } from "../core/errors.js";
import type { IndexConstituent } from "../types/indices.js";

export type ConstituentSource = "network" | "memory-cache" | "disk-cache";

export interface ConstituentLoadResult {
  constituents: IndexConstituent[];
  source: ConstituentSource;
  fetchedAt: string;
  stale: boolean;
  staleReason?: string;
}

export interface ConstituentCacheDependencies {
  fetchConstituents: (csvUrl: string) => Promise<IndexConstituent[]>;
  readCacheFile: (filePath: string) => Promise<string | undefined>;
  writeCacheFile: (filePath: string, fileContent: string) => Promise<void>;
  cacheDirectory: string;
  freshForMilliseconds: number;
  now: () => number;
  writeWarning: (message: string) => void;
}

interface CachedConstituents {
  constituents: IndexConstituent[];
  fetchedAtMilliseconds: number;
}

interface DiskCacheFile {
  fetchedAt: string;
  constituents: IndexConstituent[];
}

export function constituentCacheFileName(indexName: string): string {
  return `${indexName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
}

export class ConstituentCache {
  private readonly memoryCache = new Map<string, CachedConstituents>();
  private readonly pendingLoads = new Map<string, Promise<ConstituentLoadResult>>();

  constructor(private readonly dependencies: ConstituentCacheDependencies) {}

  load(indexName: string, csvUrl: string): Promise<ConstituentLoadResult> {
    const pendingLoad = this.pendingLoads.get(indexName);
    if (pendingLoad !== undefined) {
      return pendingLoad;
    }
    const loadPromise = this.loadUncached(indexName, csvUrl).finally(() => this.pendingLoads.delete(indexName));
    this.pendingLoads.set(indexName, loadPromise);
    return loadPromise;
  }

  private cacheFilePath(indexName: string): string {
    return path.join(this.dependencies.cacheDirectory, constituentCacheFileName(indexName));
  }

  private async loadUncached(indexName: string, csvUrl: string): Promise<ConstituentLoadResult> {
    const nowMilliseconds = this.dependencies.now();
    const memoryEntry = this.memoryCache.get(indexName);
    if (memoryEntry !== undefined && nowMilliseconds - memoryEntry.fetchedAtMilliseconds < this.dependencies.freshForMilliseconds) {
      return {
        constituents: memoryEntry.constituents,
        source: "memory-cache",
        fetchedAt: new Date(memoryEntry.fetchedAtMilliseconds).toISOString(),
        stale: false,
      };
    }

    let fetchFailureReason: string;
    try {
      const fetchedConstituents = await this.dependencies.fetchConstituents(csvUrl);
      if (fetchedConstituents.length === 0) {
        throw new AppError("NO_DATA", "constituent CSV contained no rows");
      }
      this.memoryCache.set(indexName, { constituents: fetchedConstituents, fetchedAtMilliseconds: nowMilliseconds });
      await this.persist(indexName, fetchedConstituents, nowMilliseconds);
      return {
        constituents: fetchedConstituents,
        source: "network",
        fetchedAt: new Date(nowMilliseconds).toISOString(),
        stale: false,
      };
    } catch (error: unknown) {
      const fetchError = toAppError(error);
      fetchFailureReason = `[${fetchError.code}] ${fetchError.message}`;
    }

    if (memoryEntry !== undefined) {
      this.dependencies.writeWarning(`[constituents] ${indexName}: fetch failed (${fetchFailureReason}); using stale in-memory copy.`);
      return {
        constituents: memoryEntry.constituents,
        source: "memory-cache",
        fetchedAt: new Date(memoryEntry.fetchedAtMilliseconds).toISOString(),
        stale: true,
        staleReason: fetchFailureReason,
      };
    }

    const diskEntry = await this.readDiskCache(indexName);
    if (diskEntry !== undefined) {
      this.memoryCache.set(indexName, {
        constituents: diskEntry.constituents,
        // Keep the original fetch time so the next call retries the network.
        fetchedAtMilliseconds: Date.parse(diskEntry.fetchedAt),
      });
      this.dependencies.writeWarning(`[constituents] ${indexName}: fetch failed (${fetchFailureReason}); using stale disk copy from ${diskEntry.fetchedAt}.`);
      return {
        constituents: diskEntry.constituents,
        source: "disk-cache",
        fetchedAt: diskEntry.fetchedAt,
        stale: true,
        staleReason: fetchFailureReason,
      };
    }

    throw new AppError(
      "NETWORK_ERROR",
      `[NETWORK_ERROR] ${indexName} constituents unavailable: ${fetchFailureReason}; no cached copy exists yet.`,
    );
  }

  private async persist(indexName: string, constituents: IndexConstituent[], fetchedAtMilliseconds: number): Promise<void> {
    const diskFile: DiskCacheFile = { fetchedAt: new Date(fetchedAtMilliseconds).toISOString(), constituents };
    try {
      await this.dependencies.writeCacheFile(this.cacheFilePath(indexName), JSON.stringify(diskFile));
    } catch (error: unknown) {
      this.dependencies.writeWarning(`[constituents] ${indexName}: could not write disk cache (${toAppError(error).message}).`);
    }
  }

  private async readDiskCache(indexName: string): Promise<DiskCacheFile | undefined> {
    try {
      const fileContent = await this.dependencies.readCacheFile(this.cacheFilePath(indexName));
      if (fileContent === undefined) {
        return undefined;
      }
      const parsedFile = JSON.parse(fileContent) as Partial<DiskCacheFile>;
      if (typeof parsedFile.fetchedAt !== "string" || !Array.isArray(parsedFile.constituents) || parsedFile.constituents.length === 0) {
        return undefined;
      }
      return { fetchedAt: parsedFile.fetchedAt, constituents: parsedFile.constituents };
    } catch {
      return undefined;
    }
  }
}
