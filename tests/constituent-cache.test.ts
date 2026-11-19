import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConstituentCache, constituentCacheFileName } from "../src/indices/constituent-cache.js";
import { loadIndexStocks } from "../src/indices/index-stock.service.js";
import type { IndexConstituent } from "../src/types/indices.js";
import type { InstrumentRecord } from "../src/types/instruments.js";

const HOUR = 60 * 60 * 1000;
const CACHE_DIRECTORY = path.join("virtual", "constituents");

const SAMPLE_CONSTITUENTS: IndexConstituent[] = [
  { companyName: "State Bank of India", industry: "Financial Services", symbol: "SBIN", series: "EQ", isin: "INE062A01020" },
  { companyName: "Reliance Industries Ltd.", industry: "Oil Gas", symbol: "RELIANCE", series: "EQ", isin: "INE002A01018" },
];

interface CacheHarness {
  cache: ConstituentCache;
  diskFiles: Map<string, string>;
  fetchCalls: string[];
  warnings: string[];
  setNow: (milliseconds: number) => void;
  setFetchOutcome: (outcome: IndexConstituent[] | Error) => void;
}

function buildCacheHarness(initialDiskFiles: Record<string, string> = {}): CacheHarness {
  let currentTime = Date.parse("2026-11-19T06:00:00Z");
  let fetchOutcome: IndexConstituent[] | Error = SAMPLE_CONSTITUENTS;
  const diskFiles = new Map(Object.entries(initialDiskFiles));
  const fetchCalls: string[] = [];
  const warnings: string[] = [];
  const cache = new ConstituentCache({
    fetchConstituents: async (csvUrl) => {
      fetchCalls.push(csvUrl);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (fetchOutcome instanceof Error) throw fetchOutcome;
      return fetchOutcome;
    },
    readCacheFile: async (filePath) => diskFiles.get(filePath),
    writeCacheFile: async (filePath, fileContent) => {
      diskFiles.set(filePath, fileContent);
    },
    cacheDirectory: CACHE_DIRECTORY,
    freshForMilliseconds: 12 * HOUR,
    now: () => currentTime,
    writeWarning: (message) => warnings.push(message),
  });
  return {
    cache,
    diskFiles,
    fetchCalls,
    warnings,
    setNow: (milliseconds) => (currentTime = milliseconds),
    setFetchOutcome: (outcome) => (fetchOutcome = outcome),
  };
}

const NIFTY_50_FILE = path.join(CACHE_DIRECTORY, constituentCacheFileName("NIFTY 50"));

describe("ConstituentCache", () => {
  it("fetches once, writes the disk copy, and serves fresh memory hits", async () => {
    const harness = buildCacheHarness();
    const firstLoad = await harness.cache.load("NIFTY 50", "https://example.invalid/n50.csv");
    const secondLoad = await harness.cache.load("NIFTY 50", "https://example.invalid/n50.csv");

    expect(firstLoad).toMatchObject({ source: "network", stale: false, constituents: SAMPLE_CONSTITUENTS });
    expect(secondLoad).toMatchObject({ source: "memory-cache", stale: false });
    expect(harness.fetchCalls).toHaveLength(1);
    expect(JSON.parse(harness.diskFiles.get(NIFTY_50_FILE) ?? "{}").constituents).toEqual(SAMPLE_CONSTITUENTS);
  });

  it("shares one fetch between concurrent loads", async () => {
    const harness = buildCacheHarness();
    await Promise.all(Array.from({ length: 5 }, () => harness.cache.load("NIFTY 50", "url")));
    expect(harness.fetchCalls).toHaveLength(1);
  });

  it("falls back to the stale in-memory copy when a refresh fails", async () => {
    const harness = buildCacheHarness();
    await harness.cache.load("NIFTY 50", "url");
    harness.setNow(Date.parse("2026-11-20T06:00:00Z"));
    harness.setFetchOutcome(new Error("NSE CSV request failed: 503 Service Unavailable"));

    const staleLoad = await harness.cache.load("NIFTY 50", "url");
    expect(staleLoad).toMatchObject({ source: "memory-cache", stale: true, constituents: SAMPLE_CONSTITUENTS });
    expect(staleLoad.staleReason).toMatch(/503/);
    expect(harness.warnings[0]).toMatch(/using stale in-memory copy/);
  });

  it("falls back to the disk copy after a restart when the fetch fails", async () => {
    const harness = buildCacheHarness({
      [NIFTY_50_FILE]: JSON.stringify({ fetchedAt: "2026-11-18T06:00:00.000Z", constituents: SAMPLE_CONSTITUENTS }),
    });
    harness.setFetchOutcome(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }));

    const diskLoad = await harness.cache.load("NIFTY 50", "url");
    expect(diskLoad).toMatchObject({ source: "disk-cache", stale: true, fetchedAt: "2026-11-18T06:00:00.000Z" });
    expect(diskLoad.staleReason).toMatch(/^\[NETWORK_ERROR\]/);
  });

  it("treats an empty CSV as a failure and keeps the last good copy", async () => {
    const harness = buildCacheHarness();
    await harness.cache.load("NIFTY 50", "url");
    harness.setNow(Date.parse("2026-11-20T06:00:00Z"));
    harness.setFetchOutcome([]);
    expect(await harness.cache.load("NIFTY 50", "url")).toMatchObject({ stale: true, constituents: SAMPLE_CONSTITUENTS });
  });

  it("fails only when no copy exists at all", async () => {
    const harness = buildCacheHarness();
    harness.setFetchOutcome(new Error("offline"));
    await expect(harness.cache.load("NIFTY 500", "url")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringMatching(/^\[NETWORK_ERROR\] NIFTY 500 constituents unavailable/),
    });
  });

  it("ignores corrupt disk files", async () => {
    const harness = buildCacheHarness({ [NIFTY_50_FILE]: "{not json" });
    harness.setFetchOutcome(new Error("offline"));
    await expect(harness.cache.load("NIFTY 50", "url")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("loadIndexStocks (B10)", () => {
  const instruments: InstrumentRecord[] = [
    { token: "3045", symbol: "SBIN-EQ", name: "SBIN", exch_seg: "NSE" },
    { token: "2885", symbol: "RELIANCE-BE", name: "RELIANCE", exch_seg: "NSE" },
  ];

  it("returns unmatched constituents and warns instead of dropping them silently", async () => {
    const warnings: string[] = [];
    const indexStocks = await loadIndexStocks("NIFTY 50", {
      loadConstituents: async () => ({ constituents: SAMPLE_CONSTITUENTS, source: "network", fetchedAt: "2026-11-19T06:00:00.000Z", stale: false }),
      loadInstruments: async () => instruments,
      writeWarning: (message) => warnings.push(message),
    });

    expect(indexStocks.matched.map((stock) => stock.symboltoken)).toEqual(["3045"]);
    expect(indexStocks.unmatched.map((stock) => `${stock.symbol}-${stock.series}`)).toEqual(["RELIANCE-EQ"]);
    expect(indexStocks.constituentsSource).toEqual({ source: "network", fetchedAt: "2026-11-19T06:00:00.000Z", stale: false });
    expect(warnings).toEqual(["[constituents] NIFTY 50: 1 constituents have no instrument match: RELIANCE-EQ"]);
  });

  it("passes the stale flag through", async () => {
    const indexStocks = await loadIndexStocks("NIFTY 50", {
      loadConstituents: async () => ({
        constituents: SAMPLE_CONSTITUENTS,
        source: "disk-cache",
        fetchedAt: "2026-11-18T06:00:00.000Z",
        stale: true,
        staleReason: "[NETWORK_ERROR] offline",
      }),
      loadInstruments: async () => instruments,
      writeWarning: () => undefined,
    });
    expect(indexStocks.constituentsSource).toMatchObject({ source: "disk-cache", stale: true, staleReason: "[NETWORK_ERROR] offline" });
  });
});
